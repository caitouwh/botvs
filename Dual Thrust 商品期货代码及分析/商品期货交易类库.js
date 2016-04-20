
function GetPosition(e, contractType, direction) {//获取持仓信息，供 开仓  平仓  函数 使用
    var allCost = 0;
    var allAmount = 0;
    var allProfit = 0;
    var allFrozen = 0;
    var posMargin = 0;//持仓 杠杆
    var positions = _C(e.GetPosition);//调用API  获取持仓信息
    for (var i = 0; i < positions.length; i++) {//遍历持仓信息 的 数组
        if ( positions[i].ContractType == contractType && 
        	//合约类型相同 且
            (((positions[i].Type == PD_LONG || positions[i].Type == PD_LONG_YD) && direction == PD_LONG) || ((positions[i].Type == PD_SHORT || positions[i].Type == PD_SHORT_YD) && direction == PD_SHORT))
                //（（多头仓位  或   昨日多头仓位）  且  方向 为 多头 ）       或   （ （ 空头仓位  或  昨日空头仓位 ）且 方向  空头  ）
        ) {//执行以下
            posMargin = positions[i].MarginLevel; //获取持仓合约  杠杆
            allCost += (positions[i].Price * positions[i].Amount); //累计所有符合条件的 合约的总金额
            allAmount += positions[i].Amount;//累计所有符合条件的合约的  量
            allProfit += positions[i].Profit;//累计所有符合条件的合约的  浮动盈亏
            allFrozen += positions[i].FrozenAmount;//累计所有符合条件的合约的 冻结量
        }
    }
    if (allAmount === 0) {//如果没有符合条件的 合约
        return null;//返回 null
    }
    return {//返回一个对象
        MarginLevel: posMargin,//杠杆
        FrozenAmount: allFrozen,//所有冻结
        Price: _N(allCost / allAmount),//所有该类型合约 持仓的均价
        Amount: allAmount, //持仓量
        Profit: allProfit,//总盈亏
        Type: direction,// 方向
        ContractType: contractType//持仓方向
    };
}


function Open(e, contractType, direction, opAmount) {//开仓函数，参数：交易所，合约类型，方向，数量
    var initPosition = GetPosition(e, contractType, direction);//获取持仓信息，记录在 初始 持仓对象
    var isFirst = true;//首次标记
    var initAmount = initPosition ? initPosition.Amount : 0;//有持仓信息 获取持仓数量 ， 没有 就赋值0
    var positionNow = initPosition;//initPosition更新给 positionNow 
    while (true) {//循环
        var needOpen = opAmount;//把操作量 赋值给 needOpen
        if (isFirst) {//第一次啥都不做
            isFirst = false;//更新 标记
        } else {
            positionNow = GetPosition(e,contractType, direction);//获取当前持仓信息
            if (positionNow) {//如果有持仓信息
                needOpen = opAmount - (positionNow.Amount - initAmount);
    //接下来需要开仓的量  = 操作量   -      已新开仓的量
            }
        }
        var insDetail = _C(e.SetContractType, contractType); //返回 该合约类型的 详细信息
        //Log("初始持仓", initAmount, "当前持仓", positionNow, "需要加仓", needOpen);
        if (needOpen < insDetail.MinLimitOrderVolume) {//如果 需要加仓的量 小于 该合约 允许的最小量
            break;//跳出循环
        }
        var depth = _C(e.GetDepth);//获取深度
        var amount = Math.min(insDetail.MaxLimitOrderVolume, needOpen);//amount最大 不超过insDetail.MaxLimitOrderVolume
        e.SetDirection(direction == PD_LONG ? "buy" : "sell");//设置下单类型， 方向为多头  则开多仓  ，否则 开空仓
        var orderId;//订单ID
        if (direction == PD_LONG) {//如果方向 是多头
            orderId = e.Buy(depth.Asks[0].Price + SlidePrice, Math.min(amount, depth.Asks[0].Amount), contractType, 'Ask', depth.Asks[0]);
            //开多仓  ，  卖单数组索引0元素的价格 + 滑价          交易量 不大于 索引0元素的卖单量     输出的信息： 合约类型  市场深度单
        } else {
            orderId = e.Sell(depth.Bids[0].Price - SlidePrice, Math.min(amount, depth.Bids[0].Amount), contractType, 'Bid', depth.Bids[0]);
            //开空仓同上
        }
        // CancelPendingOrders
        while (true) {
            var orders = _C(e.GetOrders);//获取 所有 未完成的 订单
            if (orders.length === 0) {//如果 未完成的 订单数组 长度为0 ，则 表示 没有未完成的 订单
                break; //跳出 while 循环
            }
            Sleep(Interval);//轮询间隔
            for (var j = 0; j < orders.length; j++) {//遍历 未完成的订单 数组
                e.CancelOrder(orders[j].Id);// 取消订单
                if (j < (orders.length - 1)) {//作用 减少一次 轮询 提升效率
                    Sleep(Interval);
                }
            }
        }
    }
    var ret = { //返回的 对象
        price: 0, //本次开仓均价
        amount: 0, //本次新增持仓量
        position: positionNow //持仓信息
    };
    if (!positionNow) {//持仓信息为null ，直接返回 ret   这种情况：没有开仓成功  返回 未修改的ret 
        return ret;
    }
    if (!initPosition) {//如果 初始 持仓信息 为null     这种情况： 开仓前 没有持仓， 更新ret 此刻持仓 为 新开仓信息
        ret.price = positionNow.Price; //用此刻持仓信息 赋值
        ret.amount = positionNow.Amount;
    } else {//这种情况： 开始有持仓， 加仓成功
        ret.amount = positionNow.Amount - initPosition.Amount;//算出新加仓的量
        ret.price = _N(((positionNow.Price * positionNow.Amount) - (initPosition.Price * initPosition.Amount)) / ret.amount);//算出新加仓的均价
    }
    return ret;//返回 ret
}

function Cover(e, contractType) {//平仓函数
    var insDetail = _C(e.SetContractType, contractType);//设置合约类型  获取合约详细信息
    while (true) {//循环
        var n = 0;
        var positions = _C(e.GetPosition);//获取持仓信息
        for (var i = 0; i < positions.length; i++) {//遍历持仓
            if (positions[i].ContractType != contractType) {//如果 不是 要平仓的 合约类型  跳过 继续找
                continue;
            }
            var amount = Math.min(insDetail.MaxLimitOrderVolume, positions[i].Amount);//设置平仓量不大于合约限制的量
            var depth;//声明 市场深度
            if (positions[i].Type == PD_LONG || positions[i].Type == PD_LONG_YD) {//如果持仓类型为多头或昨日多头仓位
                depth = _C(e.GetDepth);//获取市场深度
                e.SetDirection(positions[i].Type == PD_LONG ? "closebuy_today" : "closebuy");
                //根据是今日 还是 昨日  设置 下单类型
                e.Sell(depth.Bids[0].Price - SlidePrice, Math.min(amount, depth.Bids[0].Amount), contractType, positions[i].Type == PD_LONG ? "平今" : "平昨", 'Bid', depth.Bids[0]);
                //平多仓操作 ， 跟随 输出一些信息
                n++;//执行平仓计数累计
            } else if (positions[i].Type == PD_SHORT || positions[i].Type == PD_SHORT_YD) {
            	//如果是 空头  或昨日空头 仓位
                depth = _C(e.GetDepth);//获取市场深度
                e.SetDirection(positions[i].Type == PD_SHORT ? "closesell_today" : "closesell");
                //根据 是今日 昨日 设置 下单类型
                e.Buy(depth.Asks[0].Price + SlidePrice, Math.min(amount, depth.Asks[0].Amount), contractType, positions[i].Type == PD_SHORT ? "平今" : "平昨", 'Ask', depth.Asks[0]);
                //平空仓操作，
                n++;//执行平仓计数累计
            }
        }
        if (n === 0) {//当计数 为初始  且 不变 ，证明 没有平仓操作进行，平仓完成
            break;//跳出 while
        }
        Sleep(Interval);//轮询间隔
    }
}

//PositionManager对象的 构造函数
var PositionManager = (function() {// (一个匿名函数)(); ==> 立即执行 例如：function a(){alert("我是函数！")} ，声明后立即执行 a()；一样
    //返回PositionManager 函数 给 构造函数
    function PositionManager(e) {//闭包， 初始化？
        if (typeof(e) === 'undefined') {//参数e没有 传递进来的值 执行以下
            e = exchange;//把 交易所对象赋值给e
        }
        if (e.GetName() !== 'Futures_CTP') {//交易所  不是CTP期货 则
            throw 'Only support CTP';//抛出 错误信息
        }
        this.e = e;// 把e 赋值给 var PositionManager = (function() { , var 后的 PositionManager函数对象
        this.account = null;// 同上
    }
    PositionManager.prototype.GetAccount = function() {//prototype是每个函数对象都有的属性，它指向函数原型的引用，
    	//如果 函数为构造函数，即PositionManager用作构造函数，那么 新生成的对象 会继承prototype 的属性
        return _C(this.e.GetAccount);//本函数  给prototype 添加了一个属性函数 GetAccount 函数，获取交易所账户信息
    };

    PositionManager.prototype.OpenLong = function(contractType, shares) {//同上，开多仓，参数 合约类型（类似商品名称），份数
        if (!this.account) {//如果账户信息 不存在  null
            this.account = _C(exchange.GetAccount); //获取全局 对象 交易所对象的账户信息
        }
        return Open(this.e, contractType, PD_LONG, shares);//调用上面的  Open函数 处理开多仓。
    };

    PositionManager.prototype.OpenShort = function(contractType, shares) {//类似上面，  
        if (!this.account) {
            this.account = _C(exchange.GetAccount);
        }
        return Open(this.e, contractType, PD_SHORT, shares);//调用Open函数 处理开空仓
    };

    PositionManager.prototype.Cover = function(contractType) {//平仓
        if (!this.account) {
            this.account = _C(exchange.GetAccount);
        }
        return Cover(this.e, contractType);//调用平仓函数
    };

    PositionManager.prototype.Profit = function(contractType) {//计算 盈亏
        var accountNow = _C(this.e.GetAccount);//获取此刻账户信息
        return _N(accountNow.Balance - this.account.Balance);//计算盈亏并返回，第一次初始时account为null，不管开仓平仓，会获取一下 账户信息
    };

    return PositionManager;//返回函数对象
})();
//导出的函数   生成一个 新的  交易管理对象
$.NewPositionManager = function(e) {//JS声明函数的  一种方法，先声明后执行
    return new PositionManager(e);//返回    由PositionManager构造函数 生成的新对象
};

//测试
function main() {//测试 函数
    var p = $.NewPositionManager();
    p.OpenShort("MA609", 1);
    Sleep(60000 * 10);
    p.Cover("MA609");
    LogProfit(p.Profit());
}