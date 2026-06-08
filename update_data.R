# This script updates the data for my Canadian Oil & Gas stock pairs app

## LIBRARIES ####

#library(tidyverse)
library(tidyquant)
library(tidymodels)
library(stringr)
library(glmnet)
library(jsonlite)
library(urca)
library(slider)

## BASIC SETTINGS ####

# Select the target tickers

stock_tickers <- c("AAV.TO", "ATH.TO", "BTE.TO", "BIR.TO", "CNQ.TO", "CJ.TO", "CVE.TO", "FRU.TO", "HWX.TO", "IMO.TO", "IPO.TO", "KEL.TO", "OBE.TO", "OVV.TO", "PD.TO", "POU.TO", "PEY.TO", "PNE.TO", "PSK.TO", "SOIL.TO", "SDE.TO", "SES.TO", "SCR.TO", "SGY.TO", "SU.TO", "TVE.TO", "TNZ.TO", "TPZ.TO", "TOU.TO", "VET.TO", "WCP.TO")

etf_tickers <- c("VCN.TO", "XEG.TO")

# Set the start date for stock data

start_date <- Sys.Date() - 1000

## GET AND CLEAN DATA ####

# Stock prices

raw_prices_stocks <- tq_get(stock_tickers, 
                            get = "stock.prices", 
                            from = start_date)

prices_wide_stocks <- raw_prices_stocks |>
        select(date, symbol, adjusted) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        pivot_wider(names_from = symbol, values_from = adjusted) |>
        arrange(date) 

log_prices_stocks <- prices_wide_stocks |>
        mutate(across(-date, log))

# ETF prices

raw_prices_etfs <- tq_get(etf_tickers, 
                          get = "stock.prices", 
                          from = start_date)

prices_wide_etfs <- raw_prices_etfs |>
        select(date, symbol, adjusted) |>
        mutate(symbol = str_remove(symbol, "\\.TO")) |>
        pivot_wider(names_from = symbol, values_from = adjusted) |>
        arrange(date) 

## PRICE PREDICTIONS ####

# Settings for regression model

reg_lookback <- 250
universal_penalty <- 0.001

# Data for regression model

training_data <- log_prices_stocks |>
        drop_na() |> 
        tail(reg_lookback + 1) |> head(reg_lookback)

todays_data <- log_prices_stocks |>
        drop_na() |> 
        tail(1)

target_stocks <- setdiff(colnames(training_data), c("date"))

# Loop through the stocks using lasso regression model
# INVESTIGATE ADJUSTING THE MIXTURE

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
        
        # Make price predictions
        
        log_pred <- predict(lasso_fit, new_data = todays_data)
        expected_price <- exp(log_pred$.pred[1])
        actual_price <- exp(todays_data[[target]][1])
        divergence <- (actual_price - expected_price) / expected_price
        
        # Add price data to the loop list
        
        output_results[[target]] <- tibble(
                ticker = target,
                actual = round(actual_price, 2),
                expected = round(expected_price, 2),
                divergence_pct = round(divergence * 100, 2))
        
}

price_predictions <- bind_rows(output_results) |> 
        arrange(divergence_pct)

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
        
        # Compute Autocorrelation (ACF) for 1000-day and 250-day windows
        
        if (isTRUE(eg_res$cointegrated)) {
                
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
                
        }
        
        # Add pairs summary data to loop list
        
        pairs_results[[i]] <- tibble(
                stock_A = ticker_A,
                stock_B = ticker_B,
                buy_signal = action_signal,
                watch_list = watch_list,
                current_z_score = round(current_z, 2),
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
        group_by(symbol) |>
        arrange(date) |>
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
        slice_tail(n = 500) |> 
        ungroup() |>
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
        group_by(ratio_id) |>
        arrange(date) |>
        slice_tail(n = 500) |> 
        ungroup() |>
        mutate(ratio = round(ratio, 4))

# Save the ratio data

write_json(ratio_chart_data, 
           "data/ratio_chart_data.json", 
           pretty = TRUE)
