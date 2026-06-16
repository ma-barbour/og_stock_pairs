# This script updates the data for my Canadian Oil & Gas stock pairs app

# To start RStudio server: servr::httd()
# To stop the server: servr::daemon_stop(1)

## LIBRARIES ####

library(tidyquant)
library(tidymodels)
library(stringr)
library(glmnet)
library(jsonlite)
library(urca)
library(slider)
library(lubridate)
library(zoo)
library(tidyr)

## BASIC SETTINGS ####

# Select the target tickers

stock_tickers <- c("AAV.TO", "ATH.TO", "BTE.TO", "BIR.TO", "CNQ.TO", "CJ.TO", "CVE.TO", "FRU.TO", "HWX.TO", "IMO.TO", "IPO.TO", "KEL.TO", "OBE.TO", "OVV.TO", "POU.TO", "PEY.TO", "PSK.TO", "SOIL.TO", "SDE.TO", "SCR.TO", "SGY.TO", "SU.TO", "TVE.TO", "TPZ.TO", "TOU.TO", "WCP.TO")

etf_tickers <- c("VCN.TO", "XEG.TO")

commodity_tickers <- c("CL=F", "NG=F", "CADUSD=X", "CLM27.NYM")

# Set the start date for stock data

start_date <- Sys.Date() - 1000

# Set the start date for app charts

chart_start_date <- floor_date(Sys.Date() - days(500), "month")

## GET AND CLEAN DATA ####

# Stock prices

raw_prices_stocks <- tq_get(stock_tickers, 
                            get = "stock.prices", 
                            from = start_date)

print(paste("There are", sum(is.na(raw_prices_stocks)), "NAs in the raw_prices_stocks data"))

prices_wide_stocks <- raw_prices_stocks |>
        select(date, symbol, adjusted) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        pivot_wider(names_from = symbol, values_from = adjusted) |>
        arrange(date) |>
        mutate(across(-date, ~ zoo::na.approx(.x, na.rm = FALSE))) |>
        fill(everything(), .direction = "downup") |>
        filter(date < Sys.Date())

log_prices_stocks <- prices_wide_stocks |>
        mutate(across(-date, log))

missing_data_check <- raw_prices_stocks |>
        arrange(desc(date)) |>
        select(adjusted) |>
        head(50) |>
        summarise(na = sum(is.na(adjusted)))

write_json(missing_data_check, 
           "data/missing_data_check.json", 
           pretty = TRUE)

# ETF prices

raw_prices_etfs <- tq_get(etf_tickers, 
                          get = "stock.prices", 
                          from = start_date)

print(paste("There are", sum(is.na(raw_prices_etfs)), "in the raw_prices_stocks data"))

prices_wide_etfs <- raw_prices_etfs |>
        select(date, symbol, adjusted) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        pivot_wider(names_from = symbol, values_from = adjusted) |>
        arrange(date) |>
        mutate(across(-date, ~ zoo::na.approx(.x, na.rm = FALSE))) |>
        fill(everything(), .direction = "downup") |>
        filter(date < Sys.Date())

# Commodity prices

raw_prices_commods <- tq_get(commodity_tickers, 
                             get = "stock.prices", 
                             from = start_date)

prices_wide_commods <- raw_prices_commods |>
        select(date, symbol, adjusted) |>
        pivot_wider(names_from = symbol, values_from = adjusted) |>
        rename(WTI = 'CL=F', 
               NATGAS = 'NG=F', 
               CAD_USD = 'CADUSD=X',
               WTI_12 = 'CLM27.NYM') |>
        arrange(date) |>
        mutate(across(-date, ~ zoo::na.approx(.x, na.rm = FALSE))) |>
        fill(WTI, NATGAS, CAD_USD, WTI_12, .direction = "downup") |>
        mutate(gas_oil_ratio = NATGAS / WTI,
               .before = WTI_12) |>
        filter(date < Sys.Date()) |>
        filter(date >= start_date)

# Dividends

# Create a safe fetch for the dividend data (handles non-payors)

safe_tq_get <- possibly(tq_get, otherwise = tibble())

dividend_summary <- map_dfr(stock_tickers, function(ticker) {
        
        df <- safe_tq_get(ticker, 
                          get = "dividends", 
                          from = Sys.Date() - 100)
        
        if (is.null(df) || nrow(df) == 0) {
                
                return(tibble(symbol = ticker,
                              dividend_amount = 0,
                              dividend_frequency = "None",
                              annual_dividend = 0))
                
        }
        
        dividend_count <- nrow(df)
        dividend_amount <- df |> 
                arrange(desc(date)) |> 
                slice(1) |> 
                pull(value)
        dividend_frequency <- case_when(dividend_count >= 3 ~ "Monthly",
                                        dividend_count > 0 ~ "Quarterly",
                                        TRUE ~ "None")
        annual_dividend <- case_when(dividend_frequency == "Monthly" ~ dividend_amount * 12,
                                     dividend_frequency == "Quarterly" ~ dividend_amount * 4,
                                     TRUE ~ 0)
        
        return(tibble(symbol = ticker,
                      dividend_amount,
                      dividend_frequency,
                      annual_dividend))
        
})

latest_prices <- prices_wide_stocks |>
        tail(1) |>
        select(-date) |>
        pivot_longer(cols = everything(), 
                     names_to = "symbol", 
                     values_to = "current_price")

dividend_data <- dividend_summary |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        left_join(latest_prices, by = "symbol") |>
        mutate(yield_pct = if_else(current_price > 0, 
                                   round((annual_dividend / current_price) * 100, 2), 
                                   0)) |>
        arrange(desc(yield_pct))

write_json(dividend_data, 
           "data/dividend_data.json", 
           pretty = TRUE)

## PRICE PREDICTIONS ####

# Settings for regression model

reg_lookback <- 250
universal_penalty <- 0.00325

# Prepare data for regression model

target_stocks <- setdiff(colnames(log_prices_stocks), c("date"))

log_commods <- prices_wide_commods |>
        mutate(across(-date, log))

# Note - remove WTI_12 for this regression

combined_model_data <- log_prices_stocks |>
        left_join(log_commods |> select(-WTI_12), by = "date") |>
        drop_na()

training_data <- combined_model_data |>
        tail(reg_lookback + 1) |> head(reg_lookback)

todays_data <- combined_model_data |>
        tail(1)

# Loop through the stocks using lasso regression model
# Collect price predictions and regression data

output_results <- list()

for (target in target_stocks) {
        
        # Build the lasso regression model workflow
        
        lasso_rec <- recipe(as.formula(paste(target, "~ .")), 
                            data = training_data) |>
                update_role(date, new_role = "ID") |>
                step_normalize(all_numeric_predictors())
        
        lasso_spec <- linear_reg(penalty = universal_penalty, 
                                 mixture = 1) |> 
                set_engine("glmnet")
        
        lasso_wf <- workflow() |> 
                add_recipe(lasso_rec) |> 
                add_model(lasso_spec)
        
        # Fit the model
        
        lasso_fit <- lasso_wf |> 
                fit(data = training_data)
        
        # Extract the model's important tickers and relationships

        importances <- tidy(lasso_fit, penalty = universal_penalty) |>
                filter(term != "(Intercept)",
                       estimate != 0) |> 
                mutate(abs_estimate = abs(estimate)) |>
                arrange(desc(abs_estimate))
        
        ranked_tickers <- importances$term
        
        #print(paste(target, length(ranked_tickers)))
        
        # Make price predictions
        
        log_pred <- predict(lasso_fit, new_data = todays_data)
        expected_price <- exp(log_pred$.pred[1])
        actual_price <- exp(todays_data[[target]][1])
        divergence <- ((expected_price - actual_price) / actual_price)
        
        # Add price data to the loop list
        
        output_results[[target]] <- tibble(
                ticker = target,
                actual = round(actual_price, 2),
                expected = round(expected_price, 2),
                divergence_pct = round(divergence * 100, 2),
                ranked_predictors = list(ranked_tickers))
        
}

price_predictions <- bind_rows(output_results) |> 
        arrange(desc(divergence_pct))

# Save the updated price predictions

write_json(price_predictions, 
           "data/price_predictions.json", 
           pretty = TRUE)

## STOCK PAIRS ANALYSIS ####

# Prepare stock pairs

pair_matrix <- combn(target_stocks, 2)
num_pairs <- ncol(pair_matrix)

# Loop through the pairs:
# 1) Start with Engle-Granger cointegration test;
# 2) If stationary, compute rolling data and buy signals

pairs_results <- vector("list", num_pairs)
historical_results <- vector("list", num_pairs)
acf_results <- vector("list", num_pairs)

for (i in 1:num_pairs) {
        
        ticker_A <- pair_matrix[1, i]
        ticker_B <- pair_matrix[2, i]
        
        # Isolate log prices for the pair
        
        pair_data <- log_prices_stocks |>
                select(date, all_of(c(ticker_A, ticker_B))) |>
                rename(log_A = !!sym(ticker_A), log_B = !!sym(ticker_B)) |>
                drop_na()
        
        # Skip pairs with insufficient data
        
        if (nrow(pair_data) < 300) next
        
        # Extract the spread (residuals from OLS LM model (1000-day))
        
        pair_lm <- lm(log_A ~ log_B, data = pair_data)
        spread <- residuals(pair_lm)
        
        # Perform the Engle-Granger cointegration test
        
        eg_res <- tryCatch({
                
                ur_test <- ur.df(spread, type = "none", selectlags = "BIC")
                test_stat <- ur_test@teststat[1]
                list(stat = test_stat, cointegrated = test_stat < -3.34)
                
        }, error = function(e) list(stat = NA, cointegrated = FALSE))
        
        # Compute Autocorrelation (ACF) for 1000-day and 250-day windows, along with half-life (Ornstein-Uhlenbeck) of mean reversion and crossings
        
        if (isTRUE(eg_res$cointegrated)) {
                
                spread_lag <- spread[-length(spread)]
                spread_diff <- diff(spread)
                hl_model <- lm(spread_diff ~ spread_lag)
                lambda <- coef(hl_model)[2]
                half_life <- ifelse(!is.na(lambda) && lambda < 0, 
                                    -log(2) / lambda, 
                                    NA)
                
                spread_250 <- tail(spread, 250)
                
                acf_1000 <- acf(spread, lag.max = 100, plot = FALSE)$acf[-1]
                acf_250 <- acf(spread_250, lag.max = 100, plot = FALSE)$acf[-1]
                
                acf_results[[i]] <- tibble(
                        pair_id = paste(ticker_A, ticker_B, sep = "_"),
                        lag = 1:100,
                        acf_1000 = round(as.numeric(acf_1000), 4),
                        acf_250 = round(as.numeric(acf_250), 4))
                
        }
        
        # Compute rolling data for cointegrated pairs 
        
        if (isTRUE(eg_res$cointegrated)) {
                
                # Rolling 90-day linear regression (log prices) 
                # Rolling 60-day z-score for price spread
                
                pair_data <- pair_data |>
                        mutate(dynamic_spread = slider::slide2_dbl(
                                .x = log_B,
                                .y = log_A, 
                                .f = ~ tail(residuals(lm(.y ~ .x)), 1), 
                                .before = 89, 
                                .complete = TRUE),
                               roll_mean = slider::slide_dbl(
                                       dynamic_spread, 
                                       mean, 
                                       .before = 59, 
                                       .complete = TRUE),
                               roll_sd = slider::slide_dbl(
                                       dynamic_spread, 
                                       sd, 
                                       .before = 59, 
                                       .complete = TRUE),
                               dynamic_z = (dynamic_spread - roll_mean) / roll_sd)
                
                current_z <- tail(pair_data$dynamic_z, 1)
                
                action_signal <- case_when(current_z > 2.0 ~ ticker_B,
                                           current_z < -2.0 ~ ticker_A,
                                           TRUE ~ "None")
                
                watch_list <- case_when(current_z > 1.0 ~ ticker_B,
                                        current_z < -1.0 ~ ticker_A,
                                        TRUE ~ "None")
                
                # Capture the rolling data
                
                historical_results[[i]] <- pair_data |>
                        select(date, dynamic_z) |>
                        drop_na() |> 
                        mutate(pair_id = paste(ticker_A, ticker_B, sep = "_"))
                
        } else {
                
                current_z <- NA
                action_signal <- "None"
                watch_list <- "None"
                half_life <- NA
                
        }
        
        # Add pairs summary data to loop list
        
        pairs_results[[i]] <- tibble(
                stock_A = ticker_A,
                stock_B = ticker_B,
                buy_signal = action_signal,
                watch_list = watch_list,
                current_z_score = round(current_z, 2),
                half_life_days = round(half_life),
                r_squared = round(summary(pair_lm)$r.squared, 2),
                cointegration_stat = round(eg_res$stat, 2),
                is_cointegrated = eg_res$cointegrated)
        
}

# Isolate the valid pairs

valid_pairs <- bind_rows(pairs_results) |>
        drop_na(cointegration_stat) |>
        filter(is_cointegrated == TRUE) |>       
        filter(r_squared >= 0.7) |>
        select(-is_cointegrated) |>
        arrange(cointegration_stat) 

# Save the updated valid pairs

write_json(valid_pairs, 
           "data/valid_pairs_summary.json", 
           pretty = TRUE)

# Collect and save the ACF data

acf_chart_data <- bind_rows(acf_results) 

write_json(acf_chart_data,
           "data/acf_chart_data.json", 
           pretty = TRUE)

# Isolate the historical charting data

valid_pair_ids <- paste(valid_pairs$stock_A, valid_pairs$stock_B, sep = "_")

historical_chart_data <- bind_rows(historical_results) |>
        filter(pair_id %in% valid_pair_ids) |>
        filter(date >= chart_start_date) |>
        mutate(across(where(is.numeric), ~ round(.x, 4)))

write_json(historical_chart_data, 
           "data/sd_chart_data.json", 
           pretty = TRUE)

## PRICE CHART DATA ####

# Get valid pairs tickers

unique_valid_tickers <- unique(c(valid_pairs$stock_A, valid_pairs$stock_B))

# Generate price chart data

price_chart_data <- raw_prices_stocks |>
        select(date, symbol, adjusted) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        filter(symbol %in% unique_valid_tickers) |> 
        filter(date < Sys.Date()) |>
        group_by(symbol) |>
        arrange(date) |>
        mutate(across(-date, ~ zoo::na.approx(.x, na.rm = FALSE))) |>
        fill(everything(), .direction = "downup") |>
        mutate(sma_20 = slider::slide_dbl(
                adjusted, 
                mean, 
                .before = 19, 
                .complete = TRUE),
               sma_50 = slider::slide_dbl(
                       adjusted, 
                       mean, 
                       .before = 49, 
                       .complete = TRUE)) |>
        ungroup() |>
        filter(date >= chart_start_date) |>
        mutate(across(where(is.numeric), ~ round(.x, 2)))

# Save the updated pricing data

write_json(price_chart_data, 
           "data/price_chart_data.json", 
           pretty = TRUE)

## RATIO CHART DATA ####

all_prices_wide <- prices_wide_stocks |>
        left_join(prices_wide_etfs, by = "date")

# Loop through the valid pairs to get price ratios

ratio_results <- list()

for (k in seq_len(nrow(valid_pairs))) {
        
        ticker_A <- valid_pairs$stock_A[k]
        ticker_B <- valid_pairs$stock_B[k]
        id_str <- paste(ticker_A, ticker_B, sep = "_")
        
        ratio_results[[id_str]] <- all_prices_wide |>
                select(date, all_of(c(ticker_A, ticker_B))) |>
                drop_na() |>
                mutate(ratio = !!sym(ticker_A) / !!sym(ticker_B),
                       ratio_id = id_str) |>
                select(date, ratio_id, ratio)
        
}

# Loop through tickers to get ratio vs XEG

for (ticker in unique_valid_tickers) {
        
        id_str <- paste(ticker, "XEG", sep = "_")
        
        if (ticker %in% colnames(all_prices_wide) && "XEG" %in% colnames(all_prices_wide)) {
                
                ratio_results[[id_str]] <- all_prices_wide |>
                        select(date, all_of(c(ticker, "XEG"))) |>
                        drop_na() |>
                        mutate(ratio = !!sym(ticker) / XEG,
                               ratio_id = id_str) |>
                        select(date, ratio_id, ratio)
                
        }
        
}

# Compute XEG:VCN

if (all(c("XEG", "VCN") %in% colnames(all_prices_wide))) {
        
        id_str <- "XEG_VCN"
        
        ratio_results[[id_str]] <- all_prices_wide |>
                select(date, XEG, VCN) |>
                drop_na() |>
                mutate(ratio = XEG / VCN,
                       ratio_id = id_str) |>
                select(date, ratio_id, ratio)
}

# Finalize the ratio data

ratio_chart_data <- bind_rows(ratio_results) |>
        filter(date >= chart_start_date) |>
        mutate(ratio = round(ratio, 4))

# Save the ratio data

write_json(ratio_chart_data, 
           "data/ratio_chart_data.json", 
           pretty = TRUE)

## PRINCIPAL COMPONENT ANALYSIS (PCA) ####

pca_rec <- recipe(~ ., data = log_prices_stocks |> drop_na()) |>
        update_role(date, new_role = "ID") |>
        step_normalize(all_numeric_predictors()) |>
        step_pca(all_numeric_predictors(), 
                 num_comp = 3, 
                 id = "pca_step")

pca_prep <- prep(pca_rec)

pca_data <- bake(pca_prep, new_data = NULL) |>
        filter(date >= chart_start_date)

pca_loadings <- tidy(pca_prep, id = "pca_step") |>
        #filter(component %in% c("PC1", "PC2")) |>
        filter(component %in% c("PC1", "PC2", "PC3")) |>
        pivot_wider(names_from = component, values_from = value)

# Save the PCA data

pca_chart_data <- pca_data |>
        select(date, PC1, PC2) |>
        mutate(across(where(is.numeric), ~ round(.x, 4)))

write_json(pca_chart_data, 
           "data/pca_chart_data.json", 
           pretty = TRUE)

pca_scatter_data <- pca_loadings |>
        select(ticker = terms, PC1, PC2) |>
        mutate(across(where(is.numeric), ~ round(.x, 4)))

write_json(pca_scatter_data, 
           "data/pca_scatter_data.json", 
           pretty = TRUE)

pca_upstream_risk_data <- pca_loadings |>
        select(ticker = terms, PC2, PC3) |>
        mutate(across(where(is.numeric), ~ round(.x, 4)))

write_json(pca_upstream_risk_data, 
           "data/pca_upstream_risk_data.json", 
           pretty = TRUE)

## COMMODITY CHART DATA ####

# Save the commodity charting data

commodity_chart_data <- prices_wide_commods |>
        filter(date >= chart_start_date) |>
        drop_na() |>
        mutate(across(where(is.numeric), ~ round(.x, 4)))

write_json(commodity_chart_data, 
           "data/commodity_chart_data.json", 
           pretty = TRUE)

## COMMODITY ELASTICITY ####

# Calculate daily log returns

stock_returns <- log_prices_stocks |>
        mutate(across(-date, ~ .x - lag(.x))) |>
        drop_na()

commod_returns <- log_commods |>
        mutate(across(-date, ~ .x - lag(.x))) |>
        drop_na()

combined_returns <- stock_returns |>
        left_join(commod_returns, by = "date") |>
        drop_na()

# Run 250-day multivariate regression

recent_data <- tail(combined_returns, 250)
beta_results <- list()

for (target in target_stocks) {
        
        # Shrink the data
        
        model_data <- recent_data |> 
                select(all_of(target), WTI, NATGAS)
        #model_data <- recent_data |> 
                #select(all_of(target), WTI_12, NATGAS)
        
        # Center the data (z-scores)
        
        scaled_data <- as.data.frame(scale(model_data))
        
        # Run LM regression on the standardized 250-day window
        
        fit <- lm(as.formula(paste(target, "~ WTI + NATGAS")), 
                  data = scaled_data)
        #fit <- lm(as.formula(paste(target, "~ WTI_12 + NATGAS")), 
                  #data = scaled_data)
        
        # Extract coefficients and append to list
        beta_results[[target]] <- tibble(ticker = target,
                                         WTI_beta = coef(fit)["WTI"],
                                         #WTI_beta = coef(fit)["WTI_12"],
                                         NG_beta  = coef(fit)["NATGAS"],
                                         R_squared = summary(fit)$r.squared)
        
}

latest_betas <- bind_rows(beta_results)

# Prep the data for the app chart

dashboard_betas <- latest_betas |>
        mutate(Total_Abs_Beta = abs(WTI_beta) + abs(NG_beta),
               WTI_Share = round((abs(WTI_beta) / Total_Abs_Beta) * R_squared * 100, 1),
               NG_Share  = round((abs(NG_beta) / Total_Abs_Beta) * R_squared * 100, 1),
               Unexplained = round((1 - R_squared) * 100, 1)) |>
        arrange(desc(WTI_Share)) |>
        select(ticker, 
               WTI_Share, 
               NG_Share, 
               Unexplained)

# Save the data

write_json(dashboard_betas, 
           "data/dashboard_betas.json", 
           pretty = TRUE)

## VOLUME CHART DATA ####

# Generate volume chart data for valid pairs

stock_volume_data <- raw_prices_stocks |>
        select(date, symbol, volume) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        filter(symbol %in% unique_valid_tickers) |> 
        filter(date < Sys.Date()) |>
        group_by(symbol) |>
        arrange(date) |>
        mutate(across(-date, ~ zoo::na.approx(.x, na.rm = FALSE))) |>
        fill(everything(), .direction = "downup") |>
        mutate(vol_sma_50 = slider::slide_dbl(volume, mean, .before = 49, .complete = TRUE),
               rvol = round(volume / vol_sma_50, 2)) |>
        ungroup() |>
        filter(date >= chart_start_date) |>
        select(date, symbol, rvol)

# Generate chart data for XEG Sector ETF

etf_volume_data <- raw_prices_etfs |>
        select(date, symbol, volume) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        filter(symbol == "XEG") |>
        filter(date < Sys.Date()) |>
        group_by(symbol) |>
        arrange(date) |>
        mutate(across(-date, ~ zoo::na.approx(.x, na.rm = FALSE))) |>
        fill(everything(), .direction = "downup") |>
        mutate(vol_sma_50 = slider::slide_dbl(volume, mean, .before = 49, .complete = TRUE),
               rvol = round(volume / vol_sma_50, 2)) |>
        ungroup() |>
        filter(date >= chart_start_date) |>
        select(date, symbol, rvol)

# Save the volume data

volume_chart_data <- bind_rows(stock_volume_data, etf_volume_data)

write_json(volume_chart_data, 
           "data/volume_chart_data.json", 
           pretty = TRUE)

## GIT FIX ####

# PUSHING AFTER GITHUB ACTIONS PIPELINE RUNS

# Open the Terminal window

# Lock in local script edits:
#    git add .
#    git commit -m "Save local script updates"

# Pull the automated commit from GitHub:
#    git pull origin main

# Git will likely flag a merge conflict 
# Tell Git to just keep your local JSON files:
#    git checkout --ours data/*.json
#
# Bundle the resolved conflict and push new files:
#    git add data/
#    git commit -m "Resolve auto-generated JSON data conflict"
#    git push origin main



