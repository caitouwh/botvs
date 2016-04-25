var holdOrders = {
	arr:[], // arr`s  elements members: price 、amount 、 coverPrice 、time 
	SumProfit: 0,
    search: function(ticker){
    	var info = null;
    	for(var i = 0; i < this.arr.length; i++){
    		if(this.arr[i] === null){
    			continue;
    		}
    		if(this.arr[i].coverPrice <= ticker.Last ){
                info = $.Sell(this.arr[i].amount);
                if(info){
	                Log("cover order time:", getTimeByNormal(this.arr[i].time.getTime()),"price:",info.price,"amount:",info.amount );
	    		    //this.outArr(i);
	    		    this.SumProfit += (info.price - this.arr[i].price)*this.arr[i].amount;
	    		    LogProfit( (info.price - this.arr[i].price)*this.arr[i].amount,"为本次盈亏","总盈亏：",this.SumProfit );
	    		    this.outArr(i);
	    		    this.show(ticker);
	    		    count.close++;//ceshi
                }
    		}
    	}
    }, // if enough  coverPrice ,do  cover op. if overstep HoldOutTime and enough price do cover op 
    inArr: function(info){
    	var isFind = false;
        var orders = this.createOrder(info);
    	for(var i = 0; i < this.arr.length; i++){
            if(this.arr[i] === null){
            	this.arr[i] = orders;
            	isFind = true;
            	break;
            }
    	}
    	if(!isFind){
    		this.arr[this.arr.length] = orders;
    	}
    },  // open  and comein arr.
    outArr: function(index){
    	this.arr[index] = null;
    }, // cover and out arr.
    createOrder: function(info){
    	var orders = {
    		price: 0,
    		amount: 0,
    		coverPrice: 0,
    		time: null,
    	};
    	orders.price = info.price;
    	orders.amount = info.amount;
    	orders.coverPrice = (1 + targetProfit) * info.price;
    	orders.time = new Date();
    	return orders;
    }, //create object
    show: function(ticker){
    	var msg = "";
    	var profit = 0;
    	var sumProfit = 0;
        for(var i = 0; i < this.arr.length; i++){
        	if(this.arr[i] === null){
        		continue;
        	}
        	profit = (ticker.Last - this.arr[i].price) * this.arr[i].amount ;
        	msg += ("-" + i + ":" + this.arr[i] + "持仓盈亏：" + profit + "\n");
        	sumProfit += profit;
        } 
        Log("holdOrders:\n",msg,"持仓总浮动盈亏:",sumProfit,"arr:",this.arr );
    }
};
var lastPrice = 0;
var initAccount = null;
var lastTime = 0;
var count = {
	open: 0,
	close: 0
};
//global parameter set on UI : range 、 opAmount 、 HoldOutTime_hours 、 HoldOutTime_minute 、
// HoldOutTime_second 、Interval 、 targetProfit 、waitOutTime(hours)

function getTimeByNormal(time){
    var timeByNormal = new Date();
    timeByNormal.setTime(time);
    var strTime = timeByNormal.toString();
    var showTimeArr = strTime.split(" ");
    var showTime = showTimeArr[3]+"-"+showTimeArr[1]+"-"+showTimeArr[2]+"-"+showTimeArr[4];
    return showTime;
}

//var i = 0; //ceshi
function scan(){
	var ticker = exchange.GetTicker();
	while(!ticker){
        ticker = exchange.GetTicker();
        Sleep(Interval);
	}
	if( (lastPrice - ticker.Last) / lastPrice > range){
		var nowAccount = exchange.GetAccount();
		while(!nowAccount){
			nowAccount = exchange.GetAccount();
		}
		if(nowAccount.Balance < opAmount){
			Log("not enough money! waiting...");
			return;
		}
        var info = $.Buy(opAmount);
        if(info){
        	holdOrders.inArr(info);
		    lastPrice = ticker.Last;
		    lastTime = (new Date()).getTime();
		    count.open++;//ceshi
        }
	}//下跌，开多仓
	if( (new Date()).getTime() - lastTime > waitOutTime * 1000 * 60 * 60 ){//ceshi
        lastPrice = ticker.Last;
        lastTime = (new Date()).getTime();
    }
	holdOrders.search(ticker);// 根据市场行情  扫描持仓
}
function main(){
    initAccount = exchange.GetAccount();
    var nowAccount = initAccount;
    var ticker = exchange.GetTicker();
    while(!initAccount || !ticker){
        initAccount = exchange.GetAccount();
        ticker = exchange.GetTicker();
        Sleep(Interval);
    }
    lastPrice = ticker.Last;
    lastTime = (new Date()).getTime();
    while(true){
        scan();
        nowAccount = exchange.GetAccount();
        ticker = exchange.GetTicker();
        LogStatus("初始账户：","钱：",initAccount.Balance,"币：",initAccount.Stocks,"现在账户：","钱：",nowAccount.Balance,"币:",nowAccount.Stocks,"open:",count.open,"close:",count.close ,"\n",holdOrders.arr );
        Sleep(Interval);
    }
}
//参数：
/*
0.0005
0.1
500
0.001
1
*/