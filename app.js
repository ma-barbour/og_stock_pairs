// 1. Globals with all datasets
let summaryData = [], zHistory = [], priceHistory = [], ratioHistory = [], acfHistory = [], predictionsData = [], commodityData = [], pcaLineData = [], pcaScatterData = [], pcaRiskData = [], missingData = [], dnaData = [], volumeData = [], dividendData = [];
let charts = {}; // <-- Restored this global variable!

async function init() {
    try {
        // Fetch all 14 JSON endpoints
        const [resSum, resZ, resP, resR, resACF, resPred, resCom, resPcaLine, resPcaScatter, resPcaRisk, resMissing, resDna, resVol, resDiv] = await Promise.all([
            fetch('./data/valid_pairs_summary.json'), fetch('./data/sd_chart_data.json'),
            fetch('./data/price_chart_data.json'), fetch('./data/ratio_chart_data.json'),
            fetch('./data/acf_chart_data.json'), fetch('./data/price_predictions.json'),
            fetch('./data/commodity_chart_data.json'), fetch('./data/pca_chart_data.json'),
            fetch('./data/pca_scatter_data.json'), fetch('./data/pca_upstream_risk_data.json'), 
            fetch('./data/missing_data_check.json'), fetch('./data/dashboard_betas.json'),
            fetch('./data/volume_chart_data.json'), fetch('./data/dividend_data.json') 
        ]);
        
        // Parse ALL the JSON (restored the deleted assignments)
        summaryData = await resSum.json(); 
        zHistory = await resZ.json();
        priceHistory = await resP.json(); 
        ratioHistory = await resR.json(); 
        acfHistory = await resACF.json(); 
        predictionsData = await resPred.json();
        commodityData = await resCom.json(); 
        pcaLineData = await resPcaLine.json();
        pcaScatterData = await resPcaScatter.json();
        pcaRiskData = await resPcaRisk.json(); 
        missingData = await resMissing.json();
        dnaData = await resDna.json();
        volumeData = await resVol.json();
        dividendData = await resDiv.json(); 

        // Handle the Data Updated timestamp
        if (priceHistory.length > 0) {
            const lastDate = priceHistory[priceHistory.length - 1].date;
            document.getElementById('data-status').innerText = `Latest Data: ${new Date(lastDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}`;
        }

        // Trigger the Critical Data Missing UI Warning
        if (missingData.length > 0 && missingData[0].na > 0) {
            document.getElementById('missing-data-warning').classList.remove('hidden');
        }

        populateTable(summaryData); 
        setupDropdowns();
        renderDividendTable(); 
        
        // Render standalone macro charts (restored the deleted function calls)
        renderMomentumValueChart();
        renderCommodityRatioChart();
        renderMacroChart();
        renderPcaLineChart();
        renderMacroDnaChart();
        renderPredictionsChart(); 
        
    } catch (err) { 
        console.error(err); 
        document.getElementById('data-status').innerText = "Error loading data."; 
    }
}

function setupDropdowns() {
    const pSel = document.getElementById('primary-ticker'), sSel = document.getElementById('secondary-ticker');
    const tickers = [...new Set(summaryData.flatMap(p => [p.stock_A, p.stock_B]))].sort();
    tickers.forEach(t => pSel.add(new Option(t, t)));
    pSel.addEventListener('change', () => updateSecondaryOptions(pSel.value));
    sSel.addEventListener('change', () => refreshDashboard(pSel.value, sSel.value));
    
    const topPair = [...summaryData].sort((a, b) => Math.abs(b.current_z_score) - Math.abs(a.current_z_score))[0];
    
    if (topPair) {
        pSel.value = topPair.stock_A; 
        updateSecondaryOptions(topPair.stock_A, topPair.stock_B); 
    } else if (tickers.length > 0) {
        updateSecondaryOptions(tickers[0]);
    }
}

function updateSecondaryOptions(primary, targetSecondary = null) {
    const sSel = document.getElementById('secondary-ticker');
    sSel.innerHTML = '';
    const partners = summaryData.filter(p => p.stock_A === primary || p.stock_B === primary)
                                .map(p => p.stock_A === primary ? p.stock_B : p.stock_A).sort();
    partners.forEach(t => sSel.add(new Option(t, t)));
    
    if (targetSecondary && partners.includes(targetSecondary)) {
        sSel.value = targetSecondary;
        refreshDashboard(primary, targetSecondary);
    } else if (partners.length > 0) {
        refreshDashboard(primary, partners[0]);
    }
}

function refreshDashboard(p1, p2) {
    const pairObj = summaryData.find(p => p.stock_A === p1 && p.stock_B === p2) || summaryData.find(p => p.stock_A === p2 && p.stock_B === p1);
    if (!pairObj) return;

    const tA = pairObj.stock_A;
    const tB = pairObj.stock_B;
    const pairId = `${tA}_${tB}`;
    
    document.getElementById('zscore-header').innerText = `Z-Score Spread: ${tA} vs ${tB}`;
    document.getElementById('acf-header').innerText = `Spread Autocorrelation: ${tA} vs ${tB}`;
    document.getElementById('price-header').innerText = `Price History: ${tA} vs ${tB}`;
    document.getElementById('ratio-header').innerText = `Price Ratio: ${tA} / ${tB}`;
    document.getElementById('primary-header').innerText = `Price History: ${p1}`;
    document.getElementById('primary-xeg-header').innerText = `Relative Performance vs Sector: ${p1} / XEG`;
    document.getElementById('histogram-header').innerText = `Actual & Normal Distribution: ${tA} vs ${tB}`;
    document.getElementById('volume-header').innerText = `Trade Volume: ${tA} vs ${tB}`;
    
    renderZScoreChart(pairId, tA, tB); 
    renderSpreadHistogramChart(pairId);
    renderACFChart(pairId); 
    renderPriceChart(p1, p2); 
    renderRatioChart(pairId); 
    renderPrimaryChart(p1); 
    renderPrimaryXegChart(p1);
    renderPcaScatterChart(p1, p2);
    renderPcaRiskScatterChart(p1, p2);
    renderVolumeChart(p1, p2);
}

function populateTable(data) {
    const tbody = document.getElementById('signals-body');
    if (!tbody) return; tbody.innerHTML = '';
    
    const sortedData = [...data].sort((a, b) => Math.abs(b.current_z_score) - Math.abs(a.current_z_score));
    
    sortedData.forEach(pair => {
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-800 transition-colors cursor-pointer group";
        const isBuy = pair.buy_signal !== "None", isWatch = pair.watch_list !== "None";
        
        const actionHtml = isBuy ? `<span class="text-cyan-400 font-bold leading-tight tracking-wider">BUY<br/>${pair.buy_signal}</span>` :
                           isWatch ? `<span class="text-yellow-400 font-bold leading-tight tracking-wider">WATCH<br/>${pair.watch_list}</span>` :
                           "";

        const zC = isBuy ? "text-cyan-400 font-bold" : isWatch ? "text-yellow-400 font-bold" : "text-gray-400";
        
        row.innerHTML = `<td class="w-[20%] py-3 font-semibold text-gray-200 group-hover:text-cyan-400 align-middle">${pair.stock_A} <span class="text-gray-600 text-[10px]">vs</span> ${pair.stock_B}</td>
                         <td class="w-[20%] py-3 ${zC} font-mono align-middle">${pair.current_z_score.toFixed(2)}</td>
                         <td class="w-[20%] py-3 align-middle">${actionHtml}</td>
                         <td class="w-[20%] py-3 text-gray-300 font-mono align-middle">${pair.cointegration_stat.toFixed(2)}</td>
                         <td class="w-[20%] py-3 text-gray-300 font-mono align-middle">${pair.r_squared.toFixed(2)}</td>`;
        
        row.onclick = () => { document.getElementById('primary-ticker').value = pair.stock_A; updateSecondaryOptions(pair.stock_A); document.getElementById('secondary-ticker').value = pair.stock_B; refreshDashboard(pair.stock_A, pair.stock_B); };
        tbody.appendChild(row);
    });
}

function renderZScoreChart(pairId, tA, tB) {
    const d = zHistory.filter(v => v.pair_id === pairId);
    updateChart('zScoreChart', { 
        labels: d.map(v => v.date), 
        datasets: [{ 
            data: d.map(v => v.dynamic_z), borderColor: '#ffffff', borderWidth: 2, pointRadius: 0
        }] 
    }, {
        plugins: { 
            annotation: { 
                annotations: { 
                    zeroLine: { type: 'line', yMin: 0, yMax: 0, borderColor: '#6b7280', borderWidth: 1 }, 
                    L1: { type: 'line', yMin: 2, yMax: 2, borderColor: '#22d3ee', borderWidth: 1 }, L2: { type: 'line', yMin: -2, yMax: -2, borderColor: '#22d3ee', borderWidth: 1 }, 
                    L3: { type: 'line', yMin: 1, yMax: 1, borderColor: '#fbbf24', borderWidth: 1, borderDash: [4,4] }, L4: { type: 'line', yMin: -1, yMax: -1, borderColor: '#fbbf24', borderWidth: 1, borderDash: [4,4] },
                    labelTop: { type: 'label', yValue: 3.5, content: `BUY ${tB}`, color: '#22d3ee', font: { size: 10, weight: 'bold' } },
                    labelBottom: { type: 'label', yValue: -3.5, content: `BUY ${tA}`, color: '#22d3ee', font: { size: 10, weight: 'bold' } }
                } 
            } 
        },
        scales: { y: { min: -4, max: 4, ticks: { stepSize: 1, color: '#6b7280' } } }
    });
}

function renderSpreadHistogramChart(pairId) {
    const zValues = zHistory.filter(v => v.pair_id === pairId).map(v => v.dynamic_z);
    if(zValues.length === 0) return;

    const binSize = 0.5;
    const bins = [];
    for(let i = -4.0; i <= 4.0; i += binSize) bins.push(i);

    const counts = new Array(bins.length - 1).fill(0);
    zValues.forEach(z => {
        for(let i = 0; i < bins.length - 1; i++) {
            if (z >= bins[i] && z < bins[i+1]) { counts[i]++; break; }
        }
    });

    const labels = [];
    const normalCurve = [];
    const totalPoints = zValues.length;

    for(let i = 0; i < bins.length - 1; i++) {
        const mid = (bins[i] + bins[i+1]) / 2;
        labels.push(mid.toFixed(2));
        const pdf = (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * Math.pow(mid, 2));
        normalCurve.push(pdf * totalPoints * binSize);
    }

    updateChart('histogramChart', {
        labels: labels,
        datasets: [
            { type: 'line', label: 'Normal Distribution', data: normalCurve, borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false },
            { type: 'bar', label: 'Actual Distribution', data: counts, backgroundColor: '#4b5563', borderRadius: 2 }
        ]
    }, {
        plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 12 } } },
        scales: {
            x: { grid: { display: false }, ticks: { color: '#9ca3af' }, title: { display: true, text: 'Z-SCORE', color: '#9ca3af', font: { size: 10, weight: 'bold' } } },
            y: { 
                min: 0,
                max: 90, 
                grid: { color: '#1f2937' }, 
                ticks: { color: '#6b7280' }, 
                title: { display: true, text: 'FREQUENCY (DAYS)', color: '#9ca3af', font: { size: 10, weight: 'bold' } } 
            }
        }
    });
}

function renderACFChart(pairId) {
    const d = acfHistory.filter(v => v.pair_id === pairId);
    const labels = [0, ...d.map(v => v.lag)];
    
    const pairSummary = summaryData.find(p => `${p.stock_A}_${p.stock_B}` === pairId);
    const halfLife = pairSummary ? pairSummary.half_life_days : null;

    const chartAnnotations = {
        z: { 
            type: 'line', 
            yMin: 0, 
            yMax: 0, 
            borderColor: '#6b7280', 
            borderWidth: 1,
            borderDash: [4, 4],             
            drawTime: 'beforeDatasetsDraw'  
        }
    };

    if (halfLife && halfLife > 0) {
        chartAnnotations.halfLifeLine = {
            type: 'line',
            xMin: halfLife,
            xMax: halfLife,
            borderColor: '#9ca3af',
            borderWidth: 1.5,
            borderDash: [4, 4],
            drawTime: 'beforeDatasetsDraw',
            adjustScaleRange: false,
            label: {
                display: true,
                content: `HALF-LIFE: ${halfLife}`,
                position: 'start',
                backgroundColor: 'rgba(31, 41, 55, 0.8)',
                color: '#e5e7eb',
                font: { size: 10, weight: 'bold' },
                padding: 4
            }
        };
    }
    
    updateChart('acfChart', { 
        labels: labels, 
        datasets: [
            { label: 'Macro (1000D)', data: [1.0, ...d.map(v => v.acf_1000)], borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: false }, 
            { label: 'Recent (250D)', data: [1.0, ...d.map(v => v.acf_250)], borderColor: '#fb923c', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: false }
        ] 
    }, {
        type: 'line', 
        plugins: { 
            legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 20, boxHeight: 2 } }, 
            annotation: { 
                annotations: chartAnnotations 
            } 
        },
        scales: { 
            y: { min: -1.0, max: 1.0, ticks: { stepSize: 0.2, autoSkip: false, color: '#6b7280' } }, 
            x: { title: { display: true, text: 'TRADING DAYS', color: '#9ca3af', font: { size: 10, weight: 'bold' } }, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, color: '#6b7280', callback: (_, i) => labels[i] % 10 === 0 ? labels[i] : null } } 
        }
    });
}

function renderPriceChart(p1, p2) {
    const d1 = priceHistory.filter(v => v.symbol === p1), d2 = priceHistory.filter(v => v.symbol === p2);
    updateChart('priceChart', { labels: d1.map(v => v.date), datasets: [{ label: p1, data: d1.map(v => v.adjusted), borderColor: '#fb923c', borderWidth: 2, pointRadius: 0, yAxisID: 'y' }, { label: `${p1} 50D`, data: d1.map(v => v.sma_50), borderColor: '#fb923c', borderWidth: 2, borderDash: [4,4], pointRadius: 0, yAxisID: 'y' }, { label: p2, data: d2.map(v => v.adjusted), borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, yAxisID: 'y1' }, { label: `${p2} 50D`, data: d2.map(v => v.sma_50), borderColor: '#3b82f6', borderWidth: 2, borderDash: [4,4], pointRadius: 0, yAxisID: 'y1' }] }, {
        plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 24, boxHeight: 2 } } },
        scales: { y: { position: 'left', ticks: { color: '#fb923c' } }, y1: { position: 'right', grid: { display: false }, ticks: { color: '#3b82f6' } } }
    });
}

function renderVolumeChart(p1, p2) {
    const d1 = volumeData.filter(v => v.symbol === p1);
    const d2 = volumeData.filter(v => v.symbol === p2);

    if (d1.length === 0 || d2.length === 0) return;

    updateChart('volumeChart', {
        labels: d1.map(v => v.date),
        datasets: [
            {
                type: 'line', // Changed from bar to line
                label: p1,
                data: d1.map(v => v.rvol),
                backgroundColor: 'rgba(251, 146, 60, 0.2)', // Lighter opacity for overlapping areas
                borderColor: '#fb923c',
                borderWidth: 1.5,
                pointRadius: 0, // Hides the dots to remove horizontal clutter
                fill: false,     // Creates the Area Chart effect
                tension: 0.2    // Slightly smooths the daily jaggedness
            },
            {
                type: 'line',
                label: p2,
                data: d2.map(v => v.rvol),
                backgroundColor: 'rgba(59, 130, 246, 0.2)',
                borderColor: '#3b82f6',
                borderWidth: 1.5,
                pointRadius: 0,
                fill: false,
                tension: 0.2
            }
        ]
    }, {
        plugins: {
            legend: { display: true, position: 'top', labels: { color: '#9ca3af', usePointStyle: true, pointStyle: 'line'} },
            annotation: {
                annotations: {
                    baseline: { 
                        type: 'line', 
                        yMin: 1.0, 
                        yMax: 1.0, 
                        borderColor: '#9ca3af', 
                        borderWidth: 1.5, 
                        borderDash: [4, 4],
                        label: {
                            display: true,
                            content: '50-Day Average (1.0x)',
                            position: 'start',
                            backgroundColor: 'rgba(31, 41, 55, 0.8)',
                            color: '#e5e7eb',
                            font: { size: 10, weight: 'bold' }
                        }
                    }
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(2)}x Vol` }
            }
        },
        scales: {
            x: {
                grid: { display: false }
            },
            y: {
                position: 'left',
                max: 5.0, // <-- FIXES THE VERTICAL COMPRESSION
                grid: { color: '#1f2937' },
                ticks: {
                    color: '#6b7280',
                    stepSize: 1.0,
                    // If a spike hits the 5.0 ceiling, label it with a '+' so you know it was capped
                    callback: function(value) { return value === 5 ? '5.0x+' : value.toFixed(1) + 'x'; }
                }
            }
        }
    });
}

function renderRatioChart(pairId) {
    const d = ratioHistory.filter(v => v.ratio_id === pairId);
    if(d.length > 0) updateChart('ratioChart', { labels: d.map(v => v.date), datasets: [{ data: d.map(v => v.ratio), borderColor: '#ffffff', borderWidth: 2, pointRadius: 0 }] });
}

function renderPrimaryChart(p1) {
    const stockData = priceHistory.filter(v => v.symbol === p1);
    if (stockData.length === 0) return;

    updateChart('primaryChart', { 
        labels: stockData.map(v => v.date), 
        datasets: [
            { label: `${p1} Price`, data: stockData.map(v => v.adjusted), borderColor: '#ffffff', borderWidth: 2, pointRadius: 0 }, 
            { label: '20D MA', data: stockData.map(v => v.sma_20), borderColor: '#fb923c', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }, 
            { label: '50D MA', data: stockData.map(v => v.sma_50), borderColor: '#3b82f6', borderWidth: 2, borderDash: [4,4], pointRadius: 0 }
        ] 
    }, {
        plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 24, boxHeight: 2 } } }
    });
}

function renderPrimaryXegChart(p1) {
    const idStr = `${p1}_XEG`;
    const d = ratioHistory.filter(v => v.ratio_id === idStr);
    if(d.length > 0) updateChart('primaryXegChart', { labels: d.map(v => v.date), datasets: [{ data: d.map(v => v.ratio), borderColor: '#ffffff', borderWidth: 2, pointRadius: 0 }] });
}

function renderCommodityRatioChart() {
    if (commodityData.length === 0) return;

    updateChart('commodityRatioChart', {
        labels: commodityData.map(v => v.date),
        datasets: [
            {
                label: 'WTI PRICE',
                data: commodityData.map(v => v.WTI),
                borderColor: '#fb923c',
                borderWidth: 2,
                pointRadius: 0,
                yAxisID: 'y'
            },
            {
                label: 'WTI_12',
                data: commodityData.map(v => v.WTI_12),
                borderColor: '#6b7280', // Dark grey line
                borderWidth: 2,
                pointRadius: 0,
                yAxisID: 'y' // Shares the left axis with spot WTI
            },
            {
                label: 'NATGAS / WTI RATIO',
                data: commodityData.map(v => v.gas_oil_ratio),
                borderColor: '#3b82f6',
                borderWidth: 2,
                pointRadius: 0,
                yAxisID: 'y1'
            }
        ]
    }, {
        plugins: {
            legend: {
                display: true,
                position: 'top',
                labels: { color: '#9ca3af', boxWidth: 20, boxHeight: 2 }
            }
        },
        scales: {
            y: {
                position: 'left',
                title: { display: true, text: 'WTI PRICE', color: '#fb923c' },
                ticks: { color: '#fb923c' }
            },
            y1: {
                position: 'right',
                grid: { display: false },
                title: { display: true, text: 'NATGAS / WTI RATIO', color: '#3b82f6' },
                ticks: { color: '#3b82f6' }
            }
        }
    });
}

function renderMacroChart() {
    const ratioData = ratioHistory.filter(v => v.ratio_id === 'XEG_VCN');
    const xegVol = volumeData.filter(v => v.symbol === 'XEG');
    
    if (ratioData.length === 0 || xegVol.length === 0) return;

    // Create a date-lookup map to ensure volume perfectly aligns with the ratio dates
    const xegVolMap = new Map(xegVol.map(v => [v.date, v.rvol]));
    const alignedVolData = ratioData.map(v => xegVolMap.get(v.date) || null);

    updateChart('macroChart', {
        labels: ratioData.map(v => v.date),
        datasets: [
            {
                type: 'line',
                label: 'XEG / VCN Ratio',
                data: ratioData.map(v => v.ratio),
                borderColor: '#fb923c',
                borderWidth: 2,
                pointRadius: 0,
                yAxisID: 'y' // Left axis
            },
            {
                type: 'line',
                label: 'XEG Trade Volume (± 50D MA)',
                data: alignedVolData,
                backgroundColor: 'rgba(59, 130, 246, 0.2)', // Blue filled area
                borderColor: '#3b82f6',
                borderWidth: 1.5,
                pointRadius: 0,
                fill: false,
                tension: 0.2,
                yAxisID: 'y1' // Right axis
            }
        ]
    }, {
        plugins: { 
            legend: { 
                display: true, 
                position: 'top', 
                labels: { color: '#9ca3af', boxWidth: 12, usePointStyle: true, pointStyle: 'line' } 
            },
            annotation: {
                annotations: {
                    baseline: { 
                        type: 'line', 
                        yScaleID: 'y1', // <-- CRITICAL: Forces annotation to the RVOL axis
                        yMin: 1.0, 
                        yMax: 1.0, 
                        borderColor: '#9ca3af', 
                        borderWidth: 1.5, 
                        borderDash: [4, 4]
                    }
                }
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    label: function(ctx) {
                        if (ctx.datasetIndex === 0) return ` Ratio: ${ctx.raw.toFixed(4)}`;
                        return ` RVOL: ${ctx.raw.toFixed(2)}x`;
                    }
                }
            }
        },
        scales: {
            x: { grid: { display: false } },
            y: {
                position: 'left',
                grid: { color: '#1f2937' },
                ticks: { color: '#fb923c' }
            },
            y1: {
                position: 'right',
                max: 5.0, // Ceilings the volume spikes just like your other chart
                grid: { display: false },
                ticks: { 
                    color: '#3b82f6',
                    stepSize: 1.0,
                    callback: function(value) { return value === 5 ? '5.0x+' : value.toFixed(1) + 'x'; }
                }
            }
        }
    });
}

function renderPcaLineChart() {
    if (pcaLineData.length === 0) return;

    updateChart('pcaLineChart', { 
        labels: pcaLineData.map(v => v.date), 
        datasets: [
            { 
                label: 'Market Trend (PC1)', 
                data: pcaLineData.map(v => v.PC1), 
                borderColor: '#3b82f6', 
                borderWidth: 2, 
                pointRadius: 0,
                tension: 0.1
            },
            { 
                label: 'Sector Rotation (PC2)', 
                data: pcaLineData.map(v => v.PC2), 
                borderColor: '#fb923c', 
                borderWidth: 2, 
                pointRadius: 0,
                tension: 0.1
            }
        ] 
    }, {
        plugins: { 
            legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 20, boxHeight: 2 } },
            annotation: {
                annotations: {
                    zeroLine: { type: 'line', yMin: 0, yMax: 0, borderColor: '#4b5563', borderWidth: 1, borderDash: [4,4] }
                }
            }
        },
        scales: {
            y: { title: { display: true, text: 'FACTOR SCORE', color: '#9ca3af' } }
        }
    });
}

function renderPcaScatterChart(p1 = null, p2 = null) {
    if (pcaScatterData.length === 0) return;

    let basePoints = [];
    let highlightedPoints = [];

    pcaScatterData.forEach(d => {
        let pt = { x: d.PC1, y: d.PC2, ticker: d.ticker };
        if (d.ticker === p1 || d.ticker === p2) {
            highlightedPoints.push(pt);
        } else {
            basePoints.push(pt);
        }
    });

    const scatterPoints = [...basePoints, ...highlightedPoints];

    updateChart('pcaScatterChart', {
        datasets: [{
            label: 'Stocks',
            data: scatterPoints,
            backgroundColor: scatterPoints.map(d => {
                if (d.ticker === p1) return '#fb923c';
                if (d.ticker === p2) return '#3b82f6';
                return '#374151';
            }),
            borderColor: scatterPoints.map(d => (d.ticker === p1 || d.ticker === p2) ? '#ffffff' : '#4b5563'),
            borderWidth: 1,
            pointRadius: scatterPoints.map(d => (d.ticker === p1 || d.ticker === p2) ? 8 : 5),
            pointHoverRadius: scatterPoints.map(d => (d.ticker === p1 || d.ticker === p2) ? 10 : 7)
        }]
    }, {
        type: 'scatter',
        customPlugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : [], 
        plugins: {
            legend: { display: false },
            tooltip: { 
                callbacks: { 
                    label: (ctx) => ` ${ctx.raw.ticker}: PC1 ${ctx.raw.x.toFixed(2)} | PC2 ${ctx.raw.y.toFixed(2)}` 
                } 
            },
            datalabels: {
                display: true, 
                color: (ctx) => {
                    const t = ctx.dataset.data[ctx.dataIndex].ticker;
                    if (t === p1) return '#fb923c';
                    if (t === p2) return '#3b82f6';
                    return '#ffffff';
                }, 
                textShadowColor: 'rgba(0, 0, 0, 0.8)', 
                textShadowBlur: 4,
                z: 100, 
                align: 'right', 
                offset: 6,
                formatter: (value) => value.ticker,
                font: { weight: 'bold', size: 10 }
            },
            annotation: {
                annotations: {
                    zeroY: { type: 'line', yMin: 0, yMax: 0, borderColor: '#6b7280', borderWidth: 1, borderDash: [4,4] }
                }
            }
        },
        scales: {
            x: { 
                title: { display: true, text: 'PC1 (MARKET TREND)', color: '#9ca3af' }, 
                grid: { color: '#1f2937' }, 
                ticks: { color: '#6b7280' },
                grace: '15%' 
            },
            y: { 
                title: { display: true, text: 'PC2 (SECTOR)', color: '#9ca3af' }, 
                grid: { color: '#1f2937' }, 
                ticks: { color: '#6b7280' },
                grace: '15%' 
            }
        }
    });
}

function renderPcaRiskScatterChart(p1 = null, p2 = null) {
    if (pcaRiskData.length === 0) return;

    let basePoints = [];
    let highlightedPoints = [];

    pcaRiskData.forEach(d => {
        let pt = { x: d.PC2, y: d.PC3, ticker: d.ticker };
        if (d.ticker === p1 || d.ticker === p2) {
            highlightedPoints.push(pt);
        } else {
            basePoints.push(pt);
        }
    });

    const scatterPoints = [...basePoints, ...highlightedPoints];

    updateChart('pcaRiskScatterChart', {
        datasets: [{
            label: 'Stocks',
            data: scatterPoints,
            backgroundColor: scatterPoints.map(d => {
                if (d.ticker === p1) return '#fb923c';
                if (d.ticker === p2) return '#3b82f6';
                return '#374151';
            }),
            borderColor: scatterPoints.map(d => (d.ticker === p1 || d.ticker === p2) ? '#ffffff' : '#4b5563'),
            borderWidth: 1,
            pointRadius: scatterPoints.map(d => (d.ticker === p1 || d.ticker === p2) ? 8 : 5),
            pointHoverRadius: scatterPoints.map(d => (d.ticker === p1 || d.ticker === p2) ? 10 : 7)
        }]
    }, {
        type: 'scatter',
        customPlugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : [], 
        plugins: {
            legend: { display: false },
            tooltip: { 
                callbacks: { 
                    label: (ctx) => ` ${ctx.raw.ticker}: PC2 ${ctx.raw.x.toFixed(2)} | PC3 ${ctx.raw.y.toFixed(2)}` 
                } 
            },
            datalabels: {
                display: true, 
                color: (ctx) => {
                    const t = ctx.dataset.data[ctx.dataIndex].ticker;
                    if (t === p1) return '#fb923c';
                    if (t === p2) return '#3b82f6';
                    return '#ffffff';
                }, 
                textShadowColor: 'rgba(0, 0, 0, 0.8)', 
                textShadowBlur: 4,
                z: 100, 
                align: 'right', 
                offset: 6,
                formatter: (value) => value.ticker,
                font: { weight: 'bold', size: 10 }
            },
            annotation: {
                annotations: {
                    zeroX: { type: 'line', xMin: 0, xMax: 0, borderColor: '#6b7280', borderWidth: 1, borderDash: [4,4] },
                    zeroY: { type: 'line', yMin: 0, yMax: 0, borderColor: '#6b7280', borderWidth: 1, borderDash: [4,4] }
                }
            }
        },
        scales: {
            x: { 
                title: { display: true, text: 'PC2 (SECTOR)', color: '#9ca3af' }, 
                grid: { color: '#1f2937' }, 
                ticks: { color: '#6b7280' },
                grace: '15%' 
            },
            y: { 
                title: { display: true, text: 'PC3 (UPSTREAM RISK)', color: '#9ca3af' }, 
                grid: { color: '#1f2937' }, 
                ticks: { color: '#6b7280' },
                grace: '15%' 
            }
        }
    });
}

function renderMacroDnaChart() {
    if (dnaData.length === 0) return;

    updateChart('macroDnaChart', {
        labels: dnaData.map(d => d.ticker),
        datasets: [
            { label: 'WTI', data: dnaData.map(d => d.WTI_Share), backgroundColor: '#fb923c', borderWidth: 0 },
            { label: 'NATGAS', data: dnaData.map(d => d.NG_Share), backgroundColor: '#3b82f6', borderWidth: 0 },
            { label: 'UNEXPLAINED (R2)', data: dnaData.map(d => d.Unexplained), backgroundColor: '#374151', borderWidth: 0 }
        ]
    }, {
        type: 'bar',
        plugins: {
            legend: { display: true, position: 'bottom', labels: { color: '#9ca3af', boxWidth: 12 } },
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.raw.toFixed(1)}%` } }
        },
        scales: {
            x: { 
                stacked: true, 
                max: 100, 
                grid: { color: '#1f2937' }, 
                ticks: { color: '#6b7280', callback: val => val + '%' } 
            },
            y: { 
                stacked: true, 
                grid: { display: false }, 
                ticks: { color: '#9ca3af', font: { size: 10, weight: 'bold' } } 
            }
        },
        indexAxis: 'y'
    });
}

function renderPredictionsChart() {
    if (predictionsData.length === 0) return;
    updateChart('predictionsChart', {
        labels: predictionsData.map(d => d.ticker),
        datasets: [{
            data: predictionsData.map(d => d.divergence_pct),
            backgroundColor: predictionsData.map(d => d.divergence_pct >= 0 ? '#22d3ee' : '#ef4444'), borderWidth: 0, borderRadius: 2
        }]
    }, {
        type: 'bar',
        plugins: { tooltip: { callbacks: { label: (ctx) => ` Divergence: ${ctx.raw.toFixed(2)}%`, afterBody: (ctx) => { return `\nTop 5 Predictors:\n${predictionsData[ctx[0].dataIndex].ranked_predictors.slice(0, 5).join(', ')}`; } } } },
        scales: { x: { grid: { display: false }, ticks: { color: '#9ca3af', autoSkip: false, maxRotation: 45 } }, y: { grid: { color: '#1f2937' }, ticks: { color: '#6b7280', callback: (val) => val + '%' } } }
    });
}

function renderMomentumValueChart() {
    if(predictionsData.length === 0 || priceHistory.length === 0) return;
    
    const scatterPoints = [];
    predictionsData.forEach(p => {
        const tData = priceHistory.filter(h => h.symbol === p.ticker);
        if(tData.length > 0) {
            const latest = tData[tData.length - 1]; 
            if(latest && latest.sma_50) {
                const momentum = ((latest.adjusted - latest.sma_50) / latest.sma_50) * 100;
                scatterPoints.push({ x: momentum, y: p.divergence_pct, ticker: p.ticker });
            }
        }
    });

    updateChart('momentumValueChart', {
        datasets: [{
            label: 'Stocks',
            data: scatterPoints,
            backgroundColor: scatterPoints.map(p => (p.x > 0 && p.y > 0) ? '#22d3ee' : '#374151'), 
            borderColor: '#ffffff',
            borderWidth: 1,
            pointRadius: 6,
            pointHoverRadius: 8
        }]
    }, {
        type: 'scatter',
        customPlugins: typeof ChartDataLabels !== 'undefined' ? [ChartDataLabels] : [], 
        plugins: {
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw.ticker}: Mom ${ctx.raw.x.toFixed(1)}% | Val ${ctx.raw.y.toFixed(1)}%` } },
            datalabels: {
                display: true, 
                color: '#ffffff', 
                textShadowColor: 'rgba(0, 0, 0, 0.8)', 
                textShadowBlur: 4,
                z: 100, 
                align: 'right', 
                offset: 6,
                formatter: (value) => value.ticker,
                font: { weight: 'bold', size: 10 }
            },
            annotation: {
                annotations: {
                    zeroX: { type: 'line', xMin: 0, xMax: 0, borderColor: '#6b7280', borderWidth: 1, borderDash: [4,4] },
                    zeroY: { type: 'line', yMin: 0, yMax: 0, borderColor: '#6b7280', borderWidth: 1, borderDash: [4,4] }
                }
            }
        },
        scales: {
            x: { title: { display: true, text: 'ACTUAL PRICE VS MOVING AVERAGE (50D)', color: '#9ca3af' }, grid: { color: '#1f2937' }, ticks: { color: '#6b7280', callback: val => val+'%' } },
            y: { title: { display: true, text: 'PREDICTED PRICE CHANGE (LASSO)', color: '#9ca3af' }, grid: { color: '#1f2937' }, ticks: { color: '#6b7280', callback: val => val+'%' } }
        }
    });
}

function renderDividendTable() {
    const tbody = document.getElementById('dividend-body');
    if (!tbody || dividendData.length === 0) return;
    
    tbody.innerHTML = '';

    dividendData.forEach(row => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-800 transition-colors group cursor-default";

        // Highlight high yields (>= 5.0%), standard text for > 0%, and dim the non-payors
        let yieldColor = "text-gray-600";
        if (row.yield_pct >= 5.0) yieldColor = "text-cyan-400 font-bold";
        else if (row.yield_pct > 0) yieldColor = "text-gray-200";

        tr.innerHTML = `
            <td class="py-3 text-center font-semibold text-gray-200">${row.symbol}</td>
            <td class="py-3 text-center font-mono ${yieldColor}">${row.yield_pct.toFixed(2)}%</td>
            <td class="py-3 text-center font-mono text-gray-400">$${row.current_price.toFixed(2)}</td>
            <td class="py-3 text-center font-mono text-gray-400">$${row.annual_dividend.toFixed(2)}</td>
            <td class="py-3 text-center font-mono text-gray-400">${row.dividend_frequency}</td>
        `;
        
        tbody.appendChild(tr);
    });
}

function updateChart(id, data, extraOptions = {}) {
    if (charts[id]) charts[id].destroy();
    const c = document.getElementById(id); if (!c) return;
    
    const isTimeSeries = data.labels && data.labels.length > 0 && typeof data.labels[0] === 'string' && data.labels[0].includes('-');

    let chartScales = {
        x: {
            grid: { display: false },
            ticks: {
                autoSkip: false, maxRotation: 45, color: '#6b7280',
                callback: function(val, i) {
                    if (!isTimeSeries) return this.getLabelForValue(val);
                    
                    const dStr = data.labels[i];
                    const d = new Date(dStr);
                    if (isNaN(d.getTime())) return dStr;

                    const isFirst = i === 0;
                    let isNewMonth = false;
                    if (!isFirst) {
                        const prevD = new Date(data.labels[i - 1]);
                        isNewMonth = d.getUTCMonth() !== prevD.getUTCMonth();
                    }

                    if (isFirst || isNewMonth) {
                        return `${d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' }).toUpperCase()} ${d.toLocaleDateString('en-US', { timeZone: 'UTC', year: '2-digit' })}`; 
                    }
                    return null;
                }
            },
            ...extraOptions.scales?.x
        },
        y: { ticks: { color: '#6b7280' }, grid: { color: '#1f2937' }, ...extraOptions.scales?.y }
    };

    if (extraOptions.scales && extraOptions.scales.y1) {
        chartScales.y1 = extraOptions.scales.y1;
    }

    charts[id] = new Chart(c.getContext('2d'), {
        type: extraOptions.type || 'line', 
        data: data,
        options: { 
            indexAxis: extraOptions.indexAxis || 'x',
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                datalabels: { display: false }, 
                legend: { display: false, ...extraOptions.plugins?.legend }, 
                ...extraOptions.plugins 
            },
            scales: chartScales
        }
    });
}

let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        Object.values(charts).forEach(chart => { if (chart) chart.resize(); });
    }, 300); 
});

document.addEventListener('DOMContentLoaded', init);