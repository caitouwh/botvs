/*说明
改自 单点狙击高频加仓自动反手解套算法 V1.2 但是不反手，可以单方向做，加了止损. 效果很好, 
识货的拿走，看源码. 不多说了.

回测时资金设置在10万以上, 币设置在30以上, 这样才能达到理想效果, 资金越大, 策略抗波动能力越强
*/
/*参数
OpType                  开仓方向               下拉框(selected)   做多|做空
OpAmount                开仓数量               数字型(number)     0.1
OpMode                  开仓方式               下拉框(selected)   吃单|挂单
MaxSpace@OpMode==1      挂单失效距离           数字型(number)     0.5
SlidePrice              下单滑动价(元)         数字型(number)     0.1
MaxAmount               开仓最大单次下单量     数字型(number)     0.3
AddGoal                 加仓间距(元)           数字型(number)     1
AddLine                 加仓均价目标(元)       数字型(number)     0.8
ProfitGoal              平仓目标(元)           数字型(number)     0.5
Interval                轮询间隔(秒)           数字型(number)     1
RestoreIt               恢复进度               布尔型(true/false) false
RestoreType@RestoreIt   持仓方向               下拉框(selected)   做多|做空
RestorePrice@RestoreIt  持仓均价               数字型(number)     0
RestoreAmount@RestoreIt 持仓数量               数字型(number)     0
RestoreProfit@RestoreIt 上次盈利               数字型(number)     0
SaveLocal               保存本地日志           布尔型(true/false) false
StopLoss                止损(元)               数字型(number)     8
*/
//全局变量
var TradeType = null;//交易类型
var OrgAccount = null;//
var Counter = {s : 0, f: 0, m: 0};//计数器   s：成功次数     f：解套次数      m：止损次数
var LastProfit = 0;//最后盈利
var AllProfit = 0;//总盈利
var LastTicker = null;//最后行情
var maxHold = 0;//最大持有
var balanceSign = false;
function _N(v, precision) {//处理 数据， precision为要保留的小数位数，v是要处理的数据
    if (typeof(precision) != 'number') {//没有传入precision 参数 或 传入的不是数字  默认 precision为4
        precision = 4;
    }
    var d = parseFloat(v.toFixed(Math.max(10, precision+5)));//至少保留10位小数四舍五入，再转为浮点数。
    s = d.toString().split(".");//把上面的浮点数d 按小数点分割 返回字符串数组
    if (s.length < 2 || s[1].length <= precision) {//如果没有小数部分，或 小数部分位数长度小于等于参数precision，则
        return d;//返回浮点数d
    }

    var b = Math.pow(10, precision);//计算 10的precision次幂。
    return Math.floor(d*b)/b;//浮点数先乘b小数部分向下取整，再除b，实现了保留precision为小数，其余位数舍去
}

function EnsureCall(e, method) {//调用确认 容错功能，现已有容错模板在策略广场
    var r;
    while (!(r = e[method].apply(this, Array.prototype.slice.call(arguments).slice(2)))) {
        Sleep(Interval);//多少毫秒后重试
    }
    return r;
}

function StripOrders(e, orderId) {//取消除了ID 为 orderId 外的其他未完成的订单，详见交易类库代码注释
    var order = null;
    if (typeof(orderId) == 'undefined') {
        orderId = null;
    }
    while (true) {
        var dropped = 0;
        var orders = EnsureCall(e, 'GetOrders');
        for (var i = 0; i < orders.length; i++) {
            if (orders[i].Id == orderId) {
                order = orders[i];
            } else {
                var extra = "";
                if (orders[i].DealAmount > 0) {
                    extra = "成交: " + orders[i].DealAmount;
                } else {
                    extra = "未成交";
                }
                e.CancelOrder(orders[i].Id, orders[i].Type == ORDER_TYPE_BUY ? "买单" : "卖单", extra);
                dropped++;
            }
        }
        if (dropped == 0) {
            break;
        }
        Sleep(300);
    }
    return order;
}

function updateProfit(e, account, ticker) {//更新收益
    if (typeof(account) == 'undefined') {//如果，没传入account，此刻获取。
        account = GetAccount(e);
    }
    if (typeof(ticker) == 'undefined') {//如果，没传入行情，此刻获取。
        ticker = EnsureCall(e, "GetTicker");//容错，确保获取。
    }
    var profit = _N(LastProfit + (((account.Stocks + account.FrozenStocks) - (OrgAccount.Stocks + OrgAccount.FrozenStocks)) * ticker.Last) + ((account.Balance + account.FrozenBalance) - (OrgAccount.Balance + OrgAccount.FrozenBalance)), 4);
    //收益 =        上次收益   +   （账户总币数  -  org总币数）*此刻行情最后成交价 - （总钱 - org总钱）
    LogProfit(profit, "币数:", _N(account.Stocks + account.FrozenStocks, 4), "钱数:", _N(account.Balance + account.FrozenBalance, 4));
    //记录且输出
    return profit;//返回
}


var preMsg = "";//之前的消息
function GetAccount(e, waitFrozen) {//获取账户信息，   第二个参数  为  是否等待 冻结
    if (typeof(waitFrozen) == 'undefined') {//如果没有传入第二个参数 ，设置不等待冻结
        waitFrozen = false;
    }
    var account = null;
    var alreadyAlert = false;
    while (true) {
        account = EnsureCall(e, "GetAccount");
        if (!waitFrozen || (account.FrozenStocks < e.GetMinStock() && account.FrozenBalance < 0.01)) {
            break;
        }
        if (!alreadyAlert) {
            alreadyAlert = true;
            Log("发现账户有冻结的钱或币", account);
        }
        Sleep(Interval);
    }
    // TODO Hack
    msg = "成功: " + Counter.s + " 次, 解套: " + Counter.f + " 次, 止损: " + Counter.m + " 次, 最大持仓量: " + _N(maxHold);
    //msg = Counter.s + " / " + Counter.f + " / " + Counter.m;

    if (LastTicker != null && OrgAccount != null) {//如果最后的行情不等于空，且 最后的账户信息不等于空 
        var profit = (((account.Stocks + account.FrozenStocks) - (OrgAccount.Stocks + OrgAccount.FrozenStocks)) * LastTicker.Last) + ((account.Balance + account.FrozenBalance) - (OrgAccount.Balance + OrgAccount.FrozenBalance));
        //计算收益。
        //输出 总收益  本次收益  之前账户信息   当前账户信息  历史信息
        msg += "\n盈亏: " + AllProfit + ", 浮动: " + _N(profit, 4);
        msg += "\n初始账户 钱: " + OrgAccount.Balance + " 币: " + OrgAccount.Stocks + ", 当前账户 钱: " + _N(account.Balance + account.FrozenBalance) + " 币: " + _N(account.Stocks + account.FrozenStocks);
    }

    if (msg != preMsg) {//本次msg信息已更新（与上次不同）
        preMsg = msg;//更新上次信息
        LogStatus(msg, "#ff0000");//更新机器人状态
    }
    return account;//返回账户信息
}

// mode = 0 : direct buy, 1 : buy as buy1 交易函数  在交易类库模板有注释
function Trade(e, tradeType, tradeAmount, mode, slidePrice, maxAmount, maxSpace, retryDelay) {
    var initAccount = GetAccount(e, true);
    var nowAccount = initAccount;
    var orderId = null;
    var prePrice = 0;
    var dealAmount = 0;
    var diffMoney = 0;
    var isFirst = true;
    var tradeFunc = tradeType == ORDER_TYPE_BUY ? e.Buy : e.Sell;
    var isBuy = tradeType == ORDER_TYPE_BUY;
    while (true) {
        var ticker = EnsureCall(e, 'GetTicker');
        LastTicker = ticker;
        var tradePrice = 0;
        if (isBuy) {
            tradePrice = _N((mode == 0 ? ticker.Sell : ticker.Buy) + slidePrice, 4);
        } else {
            tradePrice = _N((mode == 0 ? ticker.Buy : ticker.Sell) - slidePrice, 4);
        }
        if (orderId == null) {
            if (isFirst) {
                isFirst = false;
            } else {
                nowAccount = GetAccount(e, true);
            }
            var doAmount = 0;
            if (isBuy) {
                diffMoney = _N(initAccount.Balance - nowAccount.Balance, 4);
                dealAmount = _N(nowAccount.Stocks - initAccount.Stocks, 4);
                doAmount = Math.min(maxAmount, tradeAmount - dealAmount, _N((nowAccount.Balance-10) / tradePrice, 4));
            } else {
                diffMoney = _N(nowAccount.Balance - initAccount.Balance, 4);
                dealAmount = _N(initAccount.Stocks - nowAccount.Stocks, 4);
                doAmount = Math.min(maxAmount, tradeAmount - dealAmount, nowAccount.Stocks);
            }
            if (doAmount < e.GetMinStock()) {
                break;
            }
            prePrice = tradePrice;
            orderId = tradeFunc(tradePrice, doAmount);
        } else {
            if (Math.abs(tradePrice - prePrice) > maxSpace) {
                orderId = null;
            }
            var order = StripOrders(exchange, orderId);
            if (order == null) {
                orderId = null;
            }
        }
        Sleep(retryDelay);
    }

    if (dealAmount <= 0) {
        return null;
    }

    return {price: _N(diffMoney / dealAmount, 4), amount: dealAmount};
}

function loop(isFirst) {//循环 函数   核心功能模块
    var minStock = exchange.GetMinStock();//获取交易所的最小交易币数
    var initAccount = GetAccount(exchange, true);//获取当前账户信息 ，等待 冻结
    //Log(initAccount);//输出当前账户信息
    var holdPrice = 0;//初始持仓价格为0
    var holdAmount = 0;//初始持仓量为0
    
    if(balanceSign) {
        if(!Cross(fastLine,slowLine,balanceSign)){
            //balanceSign = false;
            return 0;
        }
        balanceSign = false;   
    }

        //balanceSign = false;
        
    if (RestoreIt && isFirst) {//如果参数选择恢复进度为true，且程序是新启动状态（isFirst在main函数的while循环第一次循环为true，之后更新为false）
        LastProfit = RestoreProfit;//恢复最后收益
        TradeType = RestoreType == 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;//根据恢复的持仓方向（0：多，1：空）
        //确定交易类型
        holdPrice = RestorePrice;//恢复持仓均价
        holdAmount = RestoreAmount;//恢复持仓量
        if (holdAmount != 0) {//如果恢复的持仓量不等于0，执行以下
            initAccount = {//初始账户对象各属性 赋值
                Stocks: initAccount.Stocks,
                FrozenStocks: initAccount.FrozenStocks,
                Balance: initAccount.Balance,
                FrozenBalance: initAccount.FrozenBalance,
            };
            if (RestoreType == 0) {//如果恢复的持仓方向 为 多 执行以下
                initAccount.Stocks -= holdAmount;//初始账户对象的币数中 减去 持仓量
                initAccount.Balance += (holdPrice * holdAmount);//初始账户对象的钱数 加上  持仓量*持仓均价
                //此条件内  作用是  把  账户状态恢复成  持仓前的状态。
            } else {//恢复的持仓方向 为 空 执行以下 现货做空
                initAccount.Stocks += holdAmount;// 初始账户 币数 加上 持仓量
                initAccount.Balance -= (holdPrice * holdAmount);// 初始账户钱数  减去  持仓量 * 持仓均价
                //同样为恢复到做空前的账户状态
            }
            OrgAccount = initAccount;//此刻的initAccount赋给全局变量OrgAccount 。
            //作用：
            Log("恢复持仓状态为:", RestoreType == 0 ? "做多" : "做空", "均价:", holdPrice, "数量:", holdAmount);
            //输出 恢复持仓的状态信息。。。
            if (RestoreType == 0) {//如果 持仓方向为 多
                holdAmount = Math.min(initAccount.Stocks, holdAmount);//限制准备的持仓量  不大于 持仓前账户的币数 
            }
        }
        if (LastProfit != 0) {//如果恢复的最后收益不等于0 执行以下
            LogProfit(LastProfit, "恢复上次盈利");//输出
        }
    }//恢复进度完成
    if (holdAmount == 0) {//如果 持仓量 为 0 （恢复进度了持仓量为0，或者  没有恢复进度，持仓量为0），初次开仓操作
        
        //切入点，在这里设置 客户的需求
        /*
        if(!Cross(fastLine,slowLine,balanceSign) && !isFirst) {
            return 0;
        }
        balanceSign = false;
        */
        var obj = Trade(exchange, TradeType, OpAmount, OpMode, SlidePrice, MaxAmount, MaxSpace, Interval);//交易函数
        //TradeType在main里已赋值， 开仓量，开仓方式，滑价，开仓最大单次下单量，挂单失效距离，轮询间隔
        if (!obj) {//如果obj为null
            throw "出师不利, 开仓失败";//开仓失败
        } else {//obj不为null
            Log(TradeType == ORDER_TYPE_BUY ? "开多仓完成" : "开空仓完成", "均价:", obj.price, "数量:", obj.amount);
            //输出 开仓完成的信息，开仓方向、均价、数量
        }
        Log(GetAccount(exchange, true));//输出此刻账户信息
        holdPrice = obj.price;//设置持仓均价
        holdAmount = obj.amount;//设置持仓量
    }
    var openFunc = TradeType == ORDER_TYPE_BUY ? exchange.Buy : exchange.Sell;
    //根据交易类型（多、空方向） 决定 openFunc（开仓函数）  交易类型  多为买开仓  空为卖开仓
    var coverFunc = TradeType == ORDER_TYPE_BUY ? exchange.Sell : exchange.Buy;
    //根据交易类型 决定 coverFunc （平仓函数）  交易类型 多为卖平仓  空为买平仓
    var isFinished = false;//设置一个 循环完成检测量，初始值为false
    while (!isFinished) {//循环
        var account = GetAccount(exchange, true);//获取此刻账户信息  account
        var openAmount = 0;//初始开仓量0 （）
        var openPrice = 0;//开仓价格0
        var coverPrice = 0;//平仓价格0
        var canOpen = true;//能否开仓初始true

        if (TradeType == ORDER_TYPE_BUY) {//如果开仓方向为 多
            var upLine = AddLine;//加仓均价目标 赋给upLine
            openPrice = _N(holdPrice - AddGoal, 4);//持仓均价 - 加仓间距，赋给开仓价格，计算加仓价格
            openAmount = _N((holdAmount * (holdPrice - openPrice - upLine)) / upLine, 4);
            //持仓量*(持仓均价-开仓价格-加仓均价目标)/加仓均价目标， 计算出来的是  加仓量  此处有推导公式过程
            coverPrice = _N(holdPrice + ProfitGoal, 4);//持仓均价 + 平仓目标， 计算 平仓价
            if (_N(account.Balance / openPrice, 4) < openAmount) {//如果账户钱按加仓价格 不足以 按加仓量  加仓
                Log("没有钱加多仓, 需要加仓: ", openAmount, "个");//显示需要加仓的数量
                canOpen = false;//设置 能否开仓 为false
            }
        } else {//开仓方向为 空
            var upLine = -AddLine;//加仓均价目标 赋给upLine，因为做空，所以取反。
            openPrice = _N(holdPrice + AddGoal, 4);//    计算加仓价格   ，因为做空 所以 是 加
            coverPrice = _N(holdPrice - ProfitGoal, 4);//持仓均价 - 平仓目标，计算平仓价
            openAmount = _N((holdAmount * (holdPrice - openPrice - upLine) / upLine), 4);
            //计算加仓量 
            if (account.Stocks < openAmount) {//如果账户 的币数 小于 加仓量
                Log("没有币加空仓, 需要币:", openAmount);//输出信息
                canOpen = false;//设置 能否开仓 为 false
            }
        }
        if (holdAmount < minStock) {//如果 持仓过小 执行以下
            Log("剩余币数过小, 放弃操作", holdAmount);//输出信息
            return 0;//函数返回，到main函数从新循环
        }
        openAmount = Math.max(minStock, openAmount);//确保加仓量不小于交易所允许的最小值

        var order_count = 0;//订单数
        var openId = null;//开仓订单ID
        var coverId = null;//平仓订单ID
        if (!canOpen) {//如果不能加仓
            openId = -1;//开仓订单ID赋值 -1
            Log("进入等待解套模式");//没钱  加仓
        }

        for (var i = 0; i < 10; i++) {//循环10次
            if (!openId) {//如果openId为空
                openId = openFunc(openPrice, openAmount);//开仓操作
            }
            if (!coverId) {//如果coverId为空
                coverId = coverFunc(coverPrice, holdAmount);//平仓操作
            }
            if (openId && coverId) {//开仓  平仓 都执行了 才跳出
                break;
            }
            Sleep(Interval);//轮询间隔
        }
        if (!openId || !coverId) {//如果10次循环结束后 仍有开仓操作 或 平仓操作 没执行成功返回null
            StripOrders(exchange);//取消所有订单
            throw "下单失败";//抛出错误
        }
        if (openId > 0) {//如果不为解套模式
            order_count++;//订单数累计1
        }
        if (coverId > 0) {//如果平仓操作成功
            order_count++;//订单数累计1
        }

        var preAccount = account;//保存一下开仓平仓之前的账户信息
        var loss = null;//损失
        while (true) {
            Sleep(Interval);
            var ticker = EnsureCall(exchange, "GetTicker");//获取此刻行情
            LastTicker = ticker;//保存此刻行情
            var floatProfit = Math.abs(ticker.Last - coverPrice) * holdAmount;//此刻行情的最后成交价与平仓目标价格只差的绝对值*持仓量 = 浮动盈亏
            var balance = false;//不止损
            if (loss === null) {//此处的while循环第一次执行
                loss = floatProfit;//记录第一循环时的盈亏
            } else if (floatProfit - loss > StopLoss) {//每次循环到此判断 盈亏 增幅是否 大于止损值
                Log("当前浮动盈亏:", floatProfit, "开始止损");//输出信息
                StripOrders(exchange);//取消所有未完成的订单
                balance = true;//止损
            }
            var orders = EnsureCall(exchange, "GetOrders");//获得所有未完成的订单
            var nowAccount = GetAccount(exchange);//获取此刻账户信息，不等待冻结
            var diff = nowAccount.Stocks + nowAccount.FrozenStocks - preAccount.Stocks;//此刻账户总币数 - 加仓前账户币数
            if (balance) {//止损
                diff = nowAccount.Stocks + nowAccount.FrozenStocks - OrgAccount.Stocks;//修改过 此刻账户总币数 - 开仓前账户币数
                if (Math.abs(diff) > minStock) {//币数差的绝对值 大于交易所允许的最小交易量
                    var obj = Trade(exchange, diff > 0 ? ORDER_TYPE_SELL : ORDER_TYPE_BUY, Math.abs(diff), 0, SlidePrice, MaxAmount, MaxSpace, Interval);
                    //平仓 止损操作
                    if (!obj) {//如果 obj为空
                        throw "止损失败";//抛出错误  
                    } else {//成功输出  信息
                        Log(TradeType == ORDER_TYPE_BUY ? "平空仓完成" : "平多仓完成", "均价:", obj.price, "数量:", obj.amount);
                        //输出止损   平仓信息               平多仓           平空仓
                    }
                }
                nowAccount = GetAccount(exchange);//更新此刻账户信息
                AllProfit = updateProfit(exchange, GetAccount(exchange), ticker);//更新总盈亏
                initAccount = nowAccount;//把此刻账户信息 更新给 initAccount 下轮使用
                isFinished = true;//外层 while循环  结束标记 为 true
                Counter.m++;//止损次数累计
                balanceSign = true;
                break;//跳出当前循环
            }

            if (orders.length != order_count || Math.abs(diff) >= minStock) {
                //如果 当前未完成的订单数不等于 订单计数（就是有完成的订单）  或 diff的绝对值大于等于 最小交易数
                StripOrders(exchange);//取消所有未完成的订单
                nowAccount = GetAccount(exchange, true);//获取此刻账户信息
                //Log(nowAccount);//测试用
                var diffAmount = nowAccount.Stocks - initAccount.Stocks;//计算币差量
                var diffMoney = nowAccount.Balance - initAccount.Balance;//计算钱差量
                if (Math.abs(diffAmount) < minStock) {
                    AllProfit = updateProfit(exchange, nowAccount, ticker);//更新盈利
                    Log("平仓完成, 达到目标盈利点, 单次盈利", _N(holdAmount * ProfitGoal, 4));
                    initAccount = nowAccount;//更新initAccount
                    isFinished = true;//外层while循环 结束标记 为true
                    if (!canOpen) {//如果不能加仓
                        Counter.f++;//解套计数累计1
                    }
                    break;//跳出当前while
                }
                var newHoldPrice = 0;//新持仓价
                var newHoldAmount = 0;//新持仓量
                if (TradeType == ORDER_TYPE_BUY) {//如果为  多  方向
                    newHoldAmount = _N(diffAmount, 4);
                    newHoldPrice = _N((-diffMoney) / diffAmount, 4);
                } else {//空 方向
                    newHoldAmount = _N(-diffAmount, 4);
                    newHoldPrice = _N(diffMoney / (-diffAmount), 4);
                }
                // if open again, we need adjust hold positions's price
                var isAdd = false;//
                if (newHoldAmount > holdAmount) {//如果新持仓量 大于 持仓量
                    holdPrice = newHoldPrice;//更新 持仓均价
                    isAdd = true;// 设置可以加仓
                }
                holdAmount = newHoldAmount;//更新持仓量
                maxHold = Math.max(holdAmount, maxHold);//设置最大持有量  最小为maxHold
                if (!isAdd) {//如果不能加仓 持仓前账户调整
                    // reset initAccount 重设 initAccount
                    initAccount = {
                        Stocks : nowAccount.Stocks,
                        Balance : nowAccount.Balance,
                        FrozenBalance : nowAccount.FrozenBalance,
                        FrozenStocks : nowAccount.FrozenStocks,
                    };
                    if (TradeType == ORDER_TYPE_BUY) {//多仓方向
                        initAccount.Stocks -= holdAmount;
                        initAccount.Balance += holdAmount * holdPrice;
                    } else {//空仓方向
                        initAccount.Stocks += holdAmount;
                        initAccount.Balance -= holdAmount * holdPrice;
                    }
                    initAccount.Stocks = _N(initAccount.Stocks, 4);//处理数值
                    initAccount.Balance = _N(initAccount.Balance, 4);//处理数值
                    Log("持仓前账户调整为: ", initAccount);
                }
                Log((TradeType == ORDER_TYPE_BUY ? "多仓" : "空仓"), (isAdd ? "加仓后" : "平仓后"), "重新调整持仓, 均价: ", holdPrice, "数量", holdAmount);
                Log("买一:", ticker.Buy, "卖一:", ticker.Sell, "上次成交价:", ticker.Last);
                Log(nowAccount);
                break;
            }
        }
    }
    return 0;
}

function onexit() {//取消所有未完成的订单，扫尾
    StripOrders(exchange);
    Log("Exit");//输出退出
}

//均线金叉函数
var fastLine = 5;//快线指标周期
var slowLine = 10;//慢线指标周期
var LineType = 0;//均线类型 0：MA   ，1:EMA
var avgLine = [TA.MA,TA.EMA][LineType];
var overlen = 5;
function Cross(fastLine,slowLine,balanceSign){
    var records = null;
    while(true){
        //records = exchange.GetRecords();
        if(balanceSign){
            records = exchange.GetRecords(PERIOD_H1);
        }else{
            records = exchange.GetRecords();
        }
        if(records && records.length > (Math.max(fastLine, slowLine) + 3 + overlen)){
            break;
        }
        Sleep(Interval);
    }
    var len = records.length;
    var fastArr = avgLine(records,fastLine);
    var slowArr = avgLine(records,slowLine);
    if(fastArr[len-1] > slowArr[len-1] && slowArr[len-2] >= fastArr[len-2] && slowArr[len-3]>fastArr[len-3]){
        //Log(....)//测试
        return true;
    }
    return false;
}


function main() {
    if (AddLine > AddGoal || AddLine <= 0) {//加仓均价目标(元)>加仓间距    或者   加仓均价目标(元)<= 0
        throw "加仓均价目标错误";
    }
    if (exchange.GetName().indexOf("Future") != -1) {//检索交易所 名称  出现 "Future"期货 抛出以下信息
        throw "只支持现货, 期货容易爆仓, 暂不支持";
    }
    if (exchange.GetRate() != 1) {//如果汇率不为1
        Log("已禁用汇率转换");
        exchange.SetRate(1);//禁用汇率转换
    }
    TradeType = OpType == 0 ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;//根据开仓方向，确定做多？做空？
    EnableLogLocal(SaveLocal);//设置是否 储存在本地LOG  ,API中 没写~
    Interval *= 1000;//换算为毫秒
    SetErrorFilter("502:|503:|unexpected|network|timeout|WSARecv|Connect|GetAddr|no such|reset|http|received|EOF");
    //过滤错误信息
    StripOrders(exchange);//取消所有未完成的 订单
    OrgAccount = GetAccount(exchange);//获取当前账户信息
    var isFirst = true;//初始isFirst 为true
    LogStatus("启动成功", TradeType);
    while (true) {
        var ret = loop(isFirst);//第一次执行特殊操作
        isFirst = false;//更新isFirst为 false
        Counter.s++;//累计成功次数
        Sleep(Interval);//间隔暂停
    }
}
//目前比较好的参数3,7，EMA，r25，5分钟