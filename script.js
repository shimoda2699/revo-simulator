/* HIGASHIカード リボ払いシミュレーター - ロジック
   計算方式：元利定額方式（毎月の返済額が一定。返済額のうち先に手数料[利息]を
   差し引き、残りを元金に充当する）。多くのクレジットカード会社のリボ払いで
   採用されている方式にあわせています。 */
(function(){
  "use strict";

  var state = {
    essential: 30000,
    bigFreq: 2,
    bigAmount: 100000,
    payment: 10000,
    apr: 15.0,
    years: 5
  };
  var FORK_MONTH = 12;

  // ---------- helpers ----------
  function yen(n){ return "¥" + Math.round(n).toLocaleString("ja-JP"); }
  function manYen(n){
    if(n === 0) return "0円";
    return Math.round(n/10000).toLocaleString("ja-JP") + "万円";
  }
  function legalCap(balance){
    if(balance < 100000) return 20.0;
    if(balance < 1000000) return 18.0;
    return 15.0;
  }
  function legalTier(balance){
    if(balance < 100000) return 0;
    if(balance < 1000000) return 1;
    return 2;
  }
  function bigPurchaseSlots(freq){
    if(freq <= 0) return [];
    var slots = [];
    var interval = 12/freq;
    for(var k=1;k<=freq;k++){
      var slot = Math.max(1, Math.min(12, Math.round((k-0.5)*interval)));
      if(slots.indexOf(slot) === -1) slots.push(slot);
    }
    return slots;
  }

  function stepMonth(balance, monthOfYear, buying, monthlyRate, slots){
    var interest = balance * monthlyRate;
    var afterInterest = balance + interest;
    var charge = 0;
    if(buying){
      charge += state.essential;
      if(slots.indexOf(monthOfYear) !== -1) charge += state.bigAmount;
    }
    var due = afterInterest + charge;
    var payment = Math.min(state.payment, due);
    var newBalance = Math.max(0, due - payment);
    return {balance:newBalance, interest:interest, charge:charge, payment:payment};
  }

  function simulate(){
    var monthlyRate = state.apr/100/12;
    var slots = bigPurchaseSlots(state.bigFreq);
    var totalMonths = state.years*12;

    var months = [0];
    var baseSeries = [0];
    var balance = 0;
    var moy = 0;
    var totalInterestToFork = 0;
    var totalChargeToFork = 0;
    var totalPaymentToFork = 0;

    for(var m=1; m<=FORK_MONTH; m++){
      moy = ((m-1)%12)+1;
      var r = stepMonth(balance, moy, true, monthlyRate, slots);
      balance = r.balance;
      totalInterestToFork += r.interest;
      totalChargeToFork += r.charge;
      totalPaymentToFork += r.payment;
      months.push(m);
      baseSeries.push(balance);
    }
    var forkBalance = balance;

    var contSeries = [forkBalance];
    var cBal = forkBalance, cInterest = 0, cCharge = 0, cPayment = 0;
    for(var m2=FORK_MONTH+1; m2<=totalMonths; m2++){
      moy = ((m2-1)%12)+1;
      var rc = stepMonth(cBal, moy, true, monthlyRate, slots);
      cBal = rc.balance; cInterest += rc.interest; cCharge += rc.charge; cPayment += rc.payment;
      contSeries.push(cBal);
    }

    var stopSeries = [forkBalance];
    var sBal = forkBalance, sInterest = 0, sPayment = 0, payoffMonth = null;
    var extendCap = 1200;
    for(var m3=FORK_MONTH+1; m3<=totalMonths; m3++){
      moy = ((m3-1)%12)+1;
      var rs = stepMonth(sBal, moy, false, monthlyRate, slots);
      sBal = rs.balance; sInterest += rs.interest; sPayment += rs.payment;
      stopSeries.push(sBal);
      if(sBal <= 0 && payoffMonth === null){ payoffMonth = m3; }
    }
    var sBalExt = sBal, sInterestExt = sInterest, extendedPayoff = payoffMonth;
    var spiral = false;
    if(payoffMonth === null){
      var mExt = totalMonths;
      var interestAtFork = forkBalance*monthlyRate;
      if(state.payment <= interestAtFork + 0.01){
        spiral = true;
      } else {
        while(sBalExt > 0 && mExt < extendCap){
          mExt++;
          moy = ((mExt-1)%12)+1;
          var re = stepMonth(sBalExt, moy, false, monthlyRate, slots);
          sBalExt = re.balance; sInterestExt += re.interest;
        }
        if(sBalExt <= 0) extendedPayoff = mExt; else spiral = true;
      }
    }

    return {
      totalMonths: totalMonths, months: months, baseSeries: baseSeries,
      contSeries: contSeries, stopSeries: stopSeries, forkBalance: forkBalance,
      totalInterestToFork: totalInterestToFork,
      totalChargeToFork: totalChargeToFork, totalPaymentToFork: totalPaymentToFork,
      contEnd: cBal, contInterest: cInterest, contCharge: cCharge, contPayment: cPayment,
      stopEndInChart: sBal, stopInterestInChart: sInterest, stopPaymentInChart: sPayment,
      payoffMonth: payoffMonth, extendedPayoff: extendedPayoff, extendedInterest: sInterestExt,
      spiral: spiral, monthlyRate: monthlyRate
    };
  }

  function monthsToYM(m){
    var y = Math.floor(m/12), mm = m%12;
    if(y===0) return mm+"ヶ月";
    if(mm===0) return y+"年";
    return y+"年"+mm+"ヶ月";
  }

  // ---------- gauge-style range fill ----------
  function paintRange(input){
    var min = +input.min, max = +input.max, val = +input.value;
    var pct = ((val-min)/(max-min))*100;
    input.style.background =
      "linear-gradient(to right, var(--accent-1) 0%, var(--accent-2) "+pct+"%, var(--surface-sunken) "+pct+"%, var(--surface-sunken) 100%)";
  }

  // ---------- card skin selector ----------
  var cardImg = document.getElementById("cardImg");
  var skinButtons = document.querySelectorAll(".skin-btn");
  skinButtons.forEach(function(btn){
    btn.addEventListener("click", function(){
      skinButtons.forEach(function(b){ b.setAttribute("aria-pressed","false"); });
      btn.setAttribute("aria-pressed","true");
      cardImg.src = "images/card-" + btn.getAttribute("data-skin") + ".svg";
    });
  });

  // ---------- build chip-button controls ----------
  var bigFreqRow = document.getElementById("bigFreqRow");
  [0,1,2,3,4,5,6].forEach(function(f){
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip-btn"; b.textContent = f+"回";
    b.setAttribute("aria-pressed", f===state.bigFreq ? "true":"false");
    b.addEventListener("click", function(){
      state.bigFreq = f;
      Array.prototype.forEach.call(bigFreqRow.children, function(c){ c.setAttribute("aria-pressed","false"); });
      b.setAttribute("aria-pressed","true");
      render();
    });
    bigFreqRow.appendChild(b);
  });

  var yearsRow = document.getElementById("yearsRow");
  [3,5,10].forEach(function(y){
    var b = document.createElement("button");
    b.type = "button"; b.className = "chip-btn"; b.textContent = y+"年間";
    b.setAttribute("aria-pressed", y===state.years ? "true":"false");
    b.addEventListener("click", function(){
      state.years = y;
      Array.prototype.forEach.call(yearsRow.children, function(c){ c.setAttribute("aria-pressed","false"); });
      b.setAttribute("aria-pressed","true");
      render();
    });
    yearsRow.appendChild(b);
  });

  var essentialInput = document.getElementById("essential");
  var bigAmountInput = document.getElementById("bigAmount");
  var paymentInput = document.getElementById("payment");
  var aprInput = document.getElementById("apr");

  essentialInput.addEventListener("input", function(){ state.essential = +this.value; paintRange(this); render(); });
  bigAmountInput.addEventListener("input", function(){ state.bigAmount = +this.value; paintRange(this); render(); });
  paymentInput.addEventListener("input", function(){ state.payment = +this.value; paintRange(this); render(); });
  aprInput.addEventListener("input", function(){ state.apr = +this.value; paintRange(this); render(); });

  // ---------- chart geometry ----------
  var VB_W = 720, VB_H = 320;
  var M = {left:56, right:16, top:16, bottom:30};
  var plotW = VB_W - M.left - M.right;
  var plotH = VB_H - M.top - M.bottom;

  function xScale(m, totalMonths){ return M.left + (m/totalMonths)*plotW; }
  function yScale(v, maxV){ return M.top + plotH - (v/maxV)*plotH; }

  function pathFrom(monthsArr, valuesArr, totalMonths, maxV){
    var d = "";
    for(var i=0;i<monthsArr.length;i++){
      var x = xScale(monthsArr[i], totalMonths), y = yScale(valuesArr[i], maxV);
      d += (i===0 ? "M":"L") + x.toFixed(1) + "," + y.toFixed(1) + " ";
    }
    return d;
  }

  function niceMax(v){
    if(v <= 0) return 100000;
    var raw = v*1.15;
    var step = 50000;
    if(raw > 1000000) step = 200000;
    else if(raw > 400000) step = 100000;
    return Math.ceil(raw/step)*step;
  }

  var svg = document.getElementById("chartSvg");
  var gridLayer = document.getElementById("gridLayer");
  var areaLayer = document.getElementById("areaLayer");
  var lineLayer = document.getElementById("lineLayer");
  var axisLayer = document.getElementById("axisLayer");
  var forkLine = document.getElementById("forkLine");
  var forkTag = document.getElementById("forkTag");
  var hoverLine = document.getElementById("hoverLine");
  var hoverDotBase = document.getElementById("hoverDotBase");
  var hoverDotC = document.getElementById("hoverDotC");
  var hoverDotS = document.getElementById("hoverDotS");
  var hoverCapture = document.getElementById("hoverCapture");
  var tooltip = document.getElementById("tooltip");
  var chartHolder = document.getElementById("chartHolder");

  var NS = "http://www.w3.org/2000/svg";
  function el(tag, attrs){
    var e = document.createElementNS(NS, tag);
    for(var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  var lastSim = null;

  function drawChart(sim){
    var totalMonths = sim.totalMonths;
    var maxV = niceMax(Math.max.apply(null, sim.baseSeries.concat(sim.contSeries, sim.stopSeries)));

    gridLayer.innerHTML = ""; areaLayer.innerHTML = ""; lineLayer.innerHTML = ""; axisLayer.innerHTML = "";

    var ticks = 4;
    for(var t=0;t<=ticks;t++){
      var v = maxV*t/ticks;
      var y = yScale(v, maxV);
      gridLayer.appendChild(el("line", {x1:M.left, x2:VB_W-M.right, y1:y.toFixed(1), y2:y.toFixed(1), class:"grid-line"}));
      var lbl = el("text", {x:M.left-8, y:(y+3.5).toFixed(1), "text-anchor":"end", class:"axis-label"});
      lbl.textContent = manYen(v);
      axisLayer.appendChild(lbl);
    }

    for(var yy=0; yy<=totalMonths/12; yy++){
      var mm = yy*12;
      var x = xScale(mm, totalMonths);
      var lbl2 = el("text", {x:x.toFixed(1), y:VB_H-M.bottom+18, "text-anchor": yy===0 ? "start" : (mm===totalMonths?"end":"middle"), class:"axis-label"});
      lbl2.textContent = yy===0 ? "利用開始" : yy+"年後";
      axisLayer.appendChild(lbl2);
    }

    var fx = xScale(FORK_MONTH, totalMonths);
    forkLine.setAttribute("x1", fx.toFixed(1)); forkLine.setAttribute("x2", fx.toFixed(1));
    forkTag.setAttribute("x", fx.toFixed(1));
    forkTag.textContent = "現在（1年後）";
    forkTag.setAttribute("text-anchor","middle");

    var baseMonths = sim.months.slice(0, FORK_MONTH+1);
    lineLayer.appendChild(el("path", {d:pathFrom(baseMonths, sim.baseSeries, totalMonths, maxV), fill:"none", stroke:"var(--ink-300)", "stroke-width":2.5}));

    var contMonths = []; for(var i=FORK_MONTH;i<=totalMonths;i++) contMonths.push(i);
    var areaD = pathFrom(contMonths, sim.contSeries, totalMonths, maxV);
    var baseline = yScale(0, maxV);
    areaD += "L"+xScale(totalMonths,totalMonths).toFixed(1)+","+baseline.toFixed(1)+" L"+xScale(FORK_MONTH,totalMonths).toFixed(1)+","+baseline.toFixed(1)+" Z";
    areaLayer.appendChild(el("path", {d:areaD, fill:"var(--danger-soft)", stroke:"none"}));
    lineLayer.appendChild(el("path", {d:pathFrom(contMonths, sim.contSeries, totalMonths, maxV), fill:"none", stroke:"var(--danger)", "stroke-width":2.75, "stroke-linecap":"round"}));

    lineLayer.appendChild(el("path", {d:pathFrom(contMonths, sim.stopSeries, totalMonths, maxV), fill:"none", stroke:"var(--safe)", "stroke-width":2.75, "stroke-linecap":"round"}));
    if(sim.payoffMonth !== null){
      var px = xScale(sim.payoffMonth, totalMonths), py = yScale(0, maxV);
      lineLayer.appendChild(el("circle", {cx:px.toFixed(1), cy:py.toFixed(1), r:4, fill:"var(--safe)"}));
    }

    var tbody = document.getElementById("dataTableBody");
    tbody.innerHTML = "";
    var sampleMonths = [];
    for(var s=0; s<=totalMonths; s+=12) sampleMonths.push(s);
    if(sampleMonths[sampleMonths.length-1] !== totalMonths) sampleMonths.push(totalMonths);
    sampleMonths.forEach(function(mo){
      var contV = mo<=FORK_MONTH ? sim.baseSeries[mo] : sim.contSeries[mo-FORK_MONTH];
      var stopV = mo<=FORK_MONTH ? sim.baseSeries[mo] : sim.stopSeries[mo-FORK_MONTH];
      var tr = document.createElement("tr");
      tr.innerHTML = "<td>"+(mo===0?"利用開始":mo+"ヶ月後")+"</td><td class=\"num\">"+yen(contV)+"</td><td class=\"num\">"+yen(stopV)+"</td>";
      tbody.appendChild(tr);
    });
  }

  function updateHover(clientX, clientY){
    var sim = lastSim; if(!sim) return;
    var rect = svg.getBoundingClientRect();
    var scaleX = VB_W/rect.width;
    var localX = (clientX-rect.left)*scaleX;
    var m = Math.round(((localX-M.left)/plotW)*sim.totalMonths);
    m = Math.max(0, Math.min(sim.totalMonths, m));

    var maxV = niceMax(Math.max.apply(null, sim.baseSeries.concat(sim.contSeries, sim.stopSeries)));
    var x = xScale(m, sim.totalMonths);
    hoverLine.setAttribute("x1", x.toFixed(1)); hoverLine.setAttribute("x2", x.toFixed(1));
    hoverLine.style.display = "block";

    var lines = [];
    lines.push({label:"経過", value: m===0 ? "利用開始" : monthsToYM(m)+"後", color:null});
    if(m <= FORK_MONTH){
      var v = sim.baseSeries[m];
      var y = yScale(v, maxV);
      hoverDotBase.setAttribute("cx", x.toFixed(1)); hoverDotBase.setAttribute("cy", y.toFixed(1)); hoverDotBase.style.display="block";
      hoverDotC.style.display="none"; hoverDotS.style.display="none";
      lines.push({label:"残高", value: yen(v), color:"var(--ink-300)"});
    } else {
      var idx = m-FORK_MONTH;
      var vc = sim.contSeries[idx], vs = sim.stopSeries[idx];
      var yc = yScale(vc, maxV), ys = yScale(vs, maxV);
      hoverDotC.setAttribute("cx", x.toFixed(1)); hoverDotC.setAttribute("cy", yc.toFixed(1)); hoverDotC.style.display="block";
      hoverDotS.setAttribute("cx", x.toFixed(1)); hoverDotS.setAttribute("cy", ys.toFixed(1)); hoverDotS.style.display="block";
      hoverDotBase.style.display="none";
      lines.push({label:"続けた場合", value: yen(vc), color:"var(--danger)"});
      lines.push({label:"やめた場合", value: yen(vs), color:"var(--safe)"});
    }

    tooltip.innerHTML = lines.map(function(l){
      if(!l.color) return "<div>"+l.value+"</div>";
      return "<div class=\"tt-row\"><span class=\"dot\" style=\"background:"+l.color+"\"></span>"+l.label+"："+"<b>"+l.value+"</b></div>";
    }).join("");
    tooltip.style.display = "block";
    var holderRect = chartHolder.getBoundingClientRect();
    var left = (clientX - holderRect.left) + 14;
    var top = (clientY - holderRect.top) - 44;
    if(left + 170 > holderRect.width) left = (clientX - holderRect.left) - 180;
    tooltip.style.left = left+"px";
    tooltip.style.top = Math.max(0,top)+"px";
  }

  function hideHover(){
    hoverLine.style.display = "none";
    hoverDotBase.style.display = "none"; hoverDotC.style.display = "none"; hoverDotS.style.display = "none";
    tooltip.style.display = "none";
  }

  hoverCapture.addEventListener("mousemove", function(e){ updateHover(e.clientX, e.clientY); });
  hoverCapture.addEventListener("mouseleave", hideHover);
  hoverCapture.addEventListener("touchmove", function(e){
    if(e.touches && e.touches[0]){ updateHover(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
  }, {passive:false});
  hoverCapture.addEventListener("touchend", hideHover);

  // ---------- main render ----------
  function render(){
    document.getElementById("valEssential").textContent = yen(state.essential);
    document.getElementById("valBigAmount").textContent = yen(state.bigAmount);
    document.getElementById("valPayment").textContent = yen(state.payment);
    document.getElementById("valApr").textContent = state.apr.toFixed(1);

    var sim = simulate();
    lastSim = sim;

    var tier = legalTier(sim.forkBalance);
    Array.prototype.forEach.call(document.querySelectorAll("#legalTable tr"), function(tr){
      tr.classList.toggle("active", +tr.getAttribute("data-tier") === tier);
    });
    var cap = legalCap(sim.forkBalance);
    var legalCheck = document.getElementById("legalCheck");
    if(state.apr <= cap + 0.001){
      legalCheck.className = "legal-check ok";
      legalCheck.textContent = "✓ 現在の残高帯（"+yen(sim.forkBalance)+"）の上限（年"+cap.toFixed(1)+"%）以内です。";
    } else {
      legalCheck.className = "legal-check bad";
      legalCheck.textContent = "⚠ 現在の残高帯（"+yen(sim.forkBalance)+"）の上限は年"+cap.toFixed(1)+"%です。設定中の年率はこれを超えています。";
    }

    var interestAtFork = sim.forkBalance*sim.monthlyRate;
    var warn = document.getElementById("spiralWarning");
    if(state.payment <= interestAtFork + 1){
      warn.classList.add("show");
      document.getElementById("warnBalance").textContent = yen(sim.forkBalance);
      document.getElementById("warnInterest").textContent = yen(interestAtFork);
      document.getElementById("warnPayment").textContent = yen(state.payment);
    } else {
      warn.classList.remove("show");
    }

    document.getElementById("tileForkBalance").textContent = yen(sim.forkBalance);
    document.getElementById("tileContinueEnd").textContent = yen(sim.contEnd);
    document.getElementById("tileContinueSub").textContent = state.years+"年後の残高／その間の手数料合計 "+yen(sim.contInterest);

    var stopEndEl = document.getElementById("tileStopEnd");
    var stopSubEl = document.getElementById("tileStopSub");
    if(sim.spiral){
      stopEndEl.textContent = "完済できません";
      stopSubEl.textContent = "毎月の返済額が手数料(利息)以下のため、買い物をやめても残高は減りません。";
    } else if(sim.payoffMonth !== null){
      stopEndEl.textContent = monthsToYM(sim.payoffMonth)+"で完済";
      stopSubEl.textContent = "完済までに支払う手数料の合計 "+yen(sim.stopInterestInChart);
    } else {
      stopEndEl.textContent = monthsToYM(sim.extendedPayoff)+"で完済";
      stopSubEl.textContent = "表示期間を超えて完済／手数料合計 "+yen(sim.extendedInterest)+"（グラフ表示期間外を含む）";
    }

    var totalInterestAll = sim.totalInterestToFork + sim.contInterest;
    document.getElementById("extraInterest").textContent = yen(totalInterestAll);

    // ---- money-flow table: used / fee / paid / difference(=balance) ----
    var yearsTag = "（"+state.years+"年後）";
    document.getElementById("flowYearsLabelCont").textContent = yearsTag;
    document.getElementById("flowYearsLabelStop").textContent = yearsTag;

    var used1 = sim.totalChargeToFork, fee1 = sim.totalInterestToFork, paid1 = sim.totalPaymentToFork;
    var usedCont = sim.totalChargeToFork + sim.contCharge, feeCont = totalInterestAll, paidCont = sim.totalPaymentToFork + sim.contPayment;
    var usedStop = sim.totalChargeToFork, feeStop = sim.totalInterestToFork + sim.stopInterestInChart, paidStop = sim.totalPaymentToFork + sim.stopPaymentInChart;

    document.getElementById("flowUsed1").textContent = yen(used1);
    document.getElementById("flowFee1").textContent = yen(fee1);
    document.getElementById("flowPaid1").textContent = yen(paid1);
    document.getElementById("flowDiff1").textContent = yen(sim.forkBalance);

    document.getElementById("flowUsedCont").textContent = yen(usedCont);
    document.getElementById("flowFeeCont").textContent = yen(feeCont);
    document.getElementById("flowPaidCont").textContent = yen(paidCont);
    document.getElementById("flowDiffCont").textContent = yen(sim.contEnd);

    document.getElementById("flowUsedStop").textContent = yen(usedStop);
    document.getElementById("flowFeeStop").textContent = yen(feeStop);
    document.getElementById("flowPaidStop").textContent = yen(paidStop);
    document.getElementById("flowDiffStop").textContent = yen(sim.stopEndInChart);

    drawChart(sim);
    hideHover();
  }

  [essentialInput,bigAmountInput,paymentInput,aprInput].forEach(paintRange);
  render();
})();
