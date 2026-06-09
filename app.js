let summaryData = [], zHistory = [], priceHistory = [], ratioHistory = [], acfHistory = [], predictionsData = [];
let charts = {}; 

// Register globally so it works, but we will turn it off by default in updateChart()
Chart.register(ChartDataLabels);

async function init() {
    try {
        const [resSum, resZ, resP, resR, resACF, resPred] = await Promise.all([
            fetch('./data/valid_pairs_summary.json'), fetch('./data/sd_chart_data.json'),
            fetch('./data/price_chart_data.json'), fetch('./data/ratio_chart_data.json'),
            fetch('./data/acf_chart_data.json'), fetch('./data/price_predictions.json') 
        ]);
        summaryData = await resSum.json(); zHistory = await resZ.json();
        priceHistory = await resP.json(); ratioHistory = await resR.json(); 
        acfHistory = await resACF.json(); predictionsData = await resPred.json();

        if (priceHistory.length > 0) {
            const lastDate = priceHistory[priceHistory.length - 1].date;
            document.getElementById('data-status').innerText = `Data Updated: ${new Date(lastDate).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })}`;
        }
        populateTable(summaryData); setupDropdowns();
        
        renderPredictionsChart(); 
        renderMomentumValueChart();
    } catch (err) { console.error(err); document.getElementById('data-status').innerText = "Error loading data."; }
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
    document.getElementById('primary-xeg-header').innerText = `Relative Performance: ${p1} / XEG`;
    document.getElementById('histogram-header').innerText = `Distribution vs Normal Bell Curve: ${tA} vs ${tB}`;
    
    renderZScoreChart(pairId, tA, tB); 
    renderSpreadHistogramChart(pairId);
    renderACFChart(pairId); 
    renderPriceChart(p1, p2); 
    renderRatioChart(pairId); 
    renderPrimaryChart(p1); 
    renderPrimaryXegChart(p1); 
    renderMacroChart();
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
            data: d.map(v => v.dynamic_z), borderColor: '#ffffff', borderWidth: 1.5, pointRadius: 0
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
            { type: 'line', label: 'Theoretical Normal Distribution', data: normalCurve, borderColor: '#fbbf24', borderWidth: 2, pointRadius: 0, tension: 0.4, fill: false },
            { type: 'bar', label: 'Actual Distribution', data: counts, backgroundColor: '#4b5563', borderRadius: 2 }
        ]
    }, {
        plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 12 } } },
        scales: {
            x: { grid: { display: false }, ticks: { color: '#9ca3af' }, title: { display: true, text: 'Z-SCORE RANGE', color: '#9ca3af', font: { size: 10, weight: 'bold' } } },
            y: { grid: { color: '#1f2937' }, ticks: { color: '#6b7280' }, title: { display: true, text: 'FREQUENCY (DAYS)', color: '#9ca3af', font: { size: 10, weight: 'bold' } } }
        }
    });
}

function renderACFChart(pairId) {
    const d = acfHistory.filter(v => v.pair_id === pairId);
    const labels = [0, ...d.map(v => v.lag)];
    updateChart('acfChart', { labels: labels, datasets: [{ label: 'Macro', data: [1.0, ...d.map(v => v.acf_1000)], borderColor: '#3b82f6', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: false }, { label: 'Recent', data: [1.0, ...d.map(v => v.acf_250)], borderColor: '#fb923c', borderWidth: 2, pointRadius: 0, tension: 0.1, fill: false }] }, {
        type: 'line', plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 20, boxHeight: 2 } }, annotation: { annotations: { z: { type: 'line', yMin: 0, yMax: 0, borderColor: '#6b7280', borderWidth: 1 } } } },
        scales: { y: { min: -1.0, max: 1.0, ticks: { stepSize: 0.2, color: '#6b7280' } }, x: { title: { display: true, text: 'TRADING DAYS', color: '#9ca3af', font: { size: 10, weight: 'bold' } }, grid: { display: false }, ticks: { autoSkip: false, maxRotation: 0, color: '#6b7280', callback: (_, i) => labels[i] % 10 === 0 ? labels[i] : null } } }
    });
}

function renderPriceChart(p1, p2) {
    const d1 = priceHistory.filter(v => v.symbol === p1), d2 = priceHistory.filter(v => v.symbol === p2);
    updateChart('priceChart', { labels: d1.map(v => v.date), datasets: [{ label: p1, data: d1.map(v => v.adjusted), borderColor: '#fb923c', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y' }, { label: `${p1} 50D`, data: d1.map(v => v.sma_50), borderColor: '#fb923c', borderWidth: 1.5, borderDash: [4,4], pointRadius: 0, yAxisID: 'y' }, { label: p2, data: d2.map(v => v.adjusted), borderColor: '#6366f1', borderWidth: 1.5, pointRadius: 0, yAxisID: 'y1' }, { label: `${p2} 50D`, data: d2.map(v => v.sma_50), borderColor: '#6366f1', borderWidth: 1.5, borderDash: [4,4], pointRadius: 0, yAxisID: 'y1' }] }, {
        plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 24, boxHeight: 2 } } },
        scales: { y: { position: 'left', ticks: { color: '#fb923c' } }, y1: { position: 'right', grid: { display: false }, ticks: { color: '#6366f1' } } }
    });
}

function renderRatioChart(pairId) {
    const d = ratioHistory.filter(v => v.ratio_id === pairId);
    if(d.length > 0) updateChart('ratioChart', { labels: d.map(v => v.date), datasets: [{ data: d.map(v => v.ratio), borderColor: '#ffffff', borderWidth: 1.5, pointRadius: 0 }] });
}

function renderPrimaryChart(p1) {
    const d = priceHistory.filter(v => v.symbol === p1);
    updateChart('primaryChart', { labels: d.map(v => v.date), datasets: [{ label: p1, data: d.map(v => v.adjusted), borderColor: '#ffffff', borderWidth: 1.5, pointRadius: 0 }, { label: '20D MA', data: d.map(v => v.sma_20), borderColor: '#fb923c', borderWidth: 1.5, borderDash: [4,4], pointRadius: 0 }, { label: '50D MA', data: d.map(v => v.sma_50), borderColor: '#3b82f6', borderWidth: 1.5, borderDash: [4,4], pointRadius: 0 }] }, {
        plugins: { legend: { display: true, position: 'top', labels: { color: '#9ca3af', boxWidth: 24, boxHeight: 2 } } },
    });
}

function renderPrimaryXegChart(p1) {
    const idStr = `${p1}_XEG`;
    const d = ratioHistory.filter(v => v.ratio_id === idStr);
    if(d.length > 0) updateChart('primaryXegChart', { labels: d.map(v => v.date), datasets: [{ data: d.map(v => v.ratio), borderColor: '#ffffff', borderWidth: 1.5, pointRadius: 0 }] });
}

function renderMacroChart() {
    const d = ratioHistory.filter(v => v.ratio_id === 'XEG_VCN');
    if(d.length > 0) updateChart('macroChart', { labels: d.map(v => v.date), datasets: [{ data: d.map(v => v.ratio), borderColor: '#ffffff', borderWidth: 1.5, pointRadius: 0 }] });
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
        plugins: {
            tooltip: { callbacks: { label: (ctx) => ` ${ctx.raw.ticker}: Mom ${ctx.raw.x.toFixed(1)}% | Val ${ctx.raw.y.toFixed(1)}%` } },
            datalabels: {
                display: true, // Specifically turn it ON for this chart only
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
            x: { title: { display: true, text: 'MOMENTUM (PRICE VS 50D MA)', color: '#9ca3af' }, grid: { color: '#1f2937' }, ticks: { color: '#6b7280', callback: val => val+'%' } },
            y: { title: { display: true, text: 'EXPECTED VALUE (LASSO REGRESSION)', color: '#9ca3af' }, grid: { color: '#1f2937' }, ticks: { color: '#6b7280', callback: val => val+'%' } }
        }
    });
}

function updateChart(id, data, extraOptions = {}) {
    if (charts[id]) charts[id].destroy();
    const c = document.getElementById(id); if (!c) return;
    
    const isTimeSeries = data.labels && data.labels.length > 0 && typeof data.labels[0] === 'string' && data.labels[0].includes('-');

    charts[id] = new Chart(c.getContext('2d'), {
        type: extraOptions.type || 'line', 
        data: data,
        options: { 
            responsive: true, 
            maintainAspectRatio: false, 
            plugins: { 
                datalabels: { display: false }, // TURN OFF BY DEFAULT so it doesn't choke line charts
                legend: { display: false, ...extraOptions.plugins?.legend }, 
                ...extraOptions.plugins 
            },
            scales: { 
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
            }
        }
    });
}

// Debounced resize listener: Waits for phone rotation to finish (300ms) before redrawing
let resizeTimer;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        Object.values(charts).forEach(chart => { if (chart) chart.resize(); });
    }, 300); 
});

document.addEventListener('DOMContentLoaded', init);