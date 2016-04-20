//经验1、 对象赋值 当对象 含有 成员函数时  以下赋值会有问题
/*
holdOrder = {
            	orderState: ORDER_VALID,
            	price: buyInfo.price,
            	amount: buyInfo.amount,
            	time: getTimeByNormal((new Date()).getTime()),
            };
//应当这样赋值：
            holdOrder.orderState = ORDER_VALID;
            holdOrder.price = buyInfo.price;
            holdOrder.amount = buyInfo.amount;
            holdOrder.time = getTimeByNormal((new Date()).getTime());

*/


function MACD_Cross(){
    var records = exchange.GetRecords();
    while(!records || records.length < 45){
    	records = exchange.GetRecords();
    	Sleep(Interval);
    }
    var macd = TA.MACD(records,12,26,9);
    var dif = macd[0];
    var dea = macd[1];
    var column = macd[2];
    var len = records.length;
    
    // DIFF 与 DEA 均为正值,即都在零轴线以上时，大势属多头市场，DIFF 向上突破 DEA，可作买入信号。 return 1;
    if( (dif[len-1] > 0 && dea[len-1] > 0) && dif[len-1] > dea[len-1] && dif[len-2] < dea[len-2] ){
    	return 1;
    }
    //DIFF 与 DEA 均为负值,即都在零轴线以下时，大势属空头市场，DIFF 向下跌破 DEA，可作卖出信号。  return 2;
    if( dif[len-1] < dea[len-1] && dif[len-2] > dea[len-2] ){
        return 2;
    }
    
    //waiting...return 0
    return 0;  
}
var Interval = 2000;
var STATE_FREE = 0;
var STATE_BUY = 1;
//var STATE_SELL = 2;
var ORDER_INVALID = 3;
var ORDER_VALID = 4;
var state = STATE_FREE;
var SignalDelay = 0;
var stopProfit = 0.002;
var step = 0.5;
var holdOrder = {
    orderState: ORDER_INVALID,
    price: 0,
    amount: 0,
    time: null,
    stopPrice: 0,
    level: 1,
    SetStopPrice: function(records,ticker){
        if(this.orderState === ORDER_INVALID){
        	return this.stopPrice;
        }
        var len = records.length;
        if( ticker.Last <= this.price ){
            this.stopPrice = this.price * ( 1 - stopProfit );
        }else{
        	if( ticker.Last - this.price > this.level * step ){
                this.stopPrice = this.price * (1 - stopProfit) + (ticker.Last - this.price );
                this.level++;
        	}
        }
        return this.stopPrice;
    },
    initHoldOrder: function(){//初始数据
        this.orderState = ORDER_INVALID;
        this.price = 0;
        this.amount = 0;
        this.time = null;
        this.stopPrice = 0;
        this.level = 1;
    }
};

function getTimeByNormal(time){
    var timeByNormal = new Date();
    timeByNormal.setTime(time);
    var strTime = timeByNormal.toString();
    var showTimeArr = strTime.split(" ");
    var showTime = showTimeArr[3]+"-"+showTimeArr[1]+"-"+showTimeArr[2]+"-"+showTimeArr[4];
    return showTime;
}

function scan(){
	var records = exchange.GetRecords();
	var sellInfo = null;
	var buyInfo = null;
	while(!records || records.length < 10){
		records = exchange.GetRecords();
		Sleep(Interval);
	}
    while(true){//第一级分支 1、开仓 2、平仓  ，   第二级分支 平仓  1、止损平仓  2、死叉平仓
        var ticker = exchange.GetTicker();
        if(!ticker){
        	continue;
        }
        holdOrder.SetStopPrice(records,ticker);
        
        //ceshi
        //if(holdOrder.orderState === ORDER_VALID){
        	//Log("止损价格为：",holdOrder.stopPrice);
        //}//ceshi

        if(state === STATE_FREE && MACD_Cross() === 1 ){//空闲状态，遇金叉开仓
        	holdOrder.initHoldOrder();
            buyInfo = $.Buy(0.3);
            /*
            holdOrder = {
            	orderState: ORDER_VALID,
            	price: buyInfo.price,
            	amount: buyInfo.amount,
            	time: getTimeByNormal((new Date()).getTime()),
            };
            */
            holdOrder.orderState = ORDER_VALID;
            holdOrder.price = buyInfo.price;
            holdOrder.amount = buyInfo.amount;
            holdOrder.time = getTimeByNormal((new Date()).getTime());

            state = STATE_BUY;
            Log("开仓");//测试
            break;
        }else{//滑动止损 ，  设置滑动距离  更新 滑动止损价
            //stopPrice = ( ticker.Last > holdOrder.price && records[records.length - 2].Close > holdOrder.price ? holdOrder.price * (1 - stopProfit) + (records[records.length-2].Close - holdOrder.price) : holdOrder.price * (1 - stopProfit) ) ;
        	
        	if( holdOrder.orderState === ORDER_VALID && ticker.Last < holdOrder.stopPrice ){//判断止损
        	    Log("止损平仓","初始止损价：",holdOrder.price * (1 - stopProfit),"--滑动止损价：",holdOrder.stopPrice,"最后成交价：",ticker.Last,"止损等级：",holdOrder.level);//测试
        	    sellInfo = $.Sell(holdOrder.amount);
        	    /*
        	    holdOrder = {
        		    orderState: ORDER_INVALID,
        		    price: sellInfo.price,
        		    amount: sellInfo.amount,
        		    time: getTimeByNormal((new Date()).getTime()),
        	    };
        	    */
                holdOrder.orderState = ORDER_INVALID;
                holdOrder.price = sellInfo.price;
                holdOrder.amount = sellInfo.amount;
                holdOrder.time = getTimeByNormal((new Date()).getTime());

        	    state = STATE_FREE;
        	    break;
        	}
            if(state === STATE_BUY && MACD_Cross() === 2 ){//持仓状态，遇死叉平仓
        	    sellInfo = $.Sell(holdOrder.amount);
        	    Log(holdOrder.price);//ceshi
        	    Log("死叉平仓","初始止损价：",holdOrder.price * (1 - stopProfit),"--滑动止损价：",holdOrder.stopPrice,"最后成交价：",ticker.Last,"止损等级：",holdOrder.level);//测试
        	    /*
        	    holdOrder = {
        		    orderState: ORDER_INVALID,
        		    price: sellInfo.price,
        		    amount: sellInfo.amount,
        		    time: getTimeByNormal((new Date()).getTime()),
        	    };
        	    */
                holdOrder.orderState = ORDER_INVALID;
                holdOrder.price = sellInfo.price;
                holdOrder.amount = sellInfo.amount;
                holdOrder.time = getTimeByNormal((new Date()).getTime());

        	    state = STATE_FREE;
        	    break;
            }
        }
        Sleep(Interval);
    }
}
function onexit(){
    var exitAccount = $.GetAccount(exchange,true);
	Log("退出，当前账户信息",exitAccount);
}
function main(){
    var initAccount = $.GetAccount(exchange,true);
    var nowAccount = initAccount;
    var diffMoney = 0;
    var diffStocks = 0;
    var repair = 0;
    var ticker = exchange.GetTicker();
    Log("初始账户：",initAccount);
    while(true){
        scan();
        ticker = exchange.GetTicker();
        if(!ticker){
        	continue;
        }
        if(holdOrder.orderState == ORDER_VALID){
        	Log("当前持仓：",holdOrder);
        }
        if(holdOrder.orderState == ORDER_INVALID){
        	nowAccount = $.GetAccount(exchange,true);
            diffMoney = nowAccount.Balance - initAccount.Balance;
            diffStocks = nowAccount.Stocks - initAccount.Stocks;
            repair = diffStocks * ticker.Last;
            LogProfit(diffMoney + repair ,"RMB");
        }
    	Sleep(Interval);
    }
    Log("初始账户：",initAccount);
    onexit();
}