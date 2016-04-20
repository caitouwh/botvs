/*
> 基本原理
- 在当天收盘，计算两个值： 最高价－收盘价，和收盘价－最低价。然后取这两个值较大的那个，乘以k值，结果称为触发值。
- 在第二天开盘，记录开盘价，然后在价格超过（开盘＋触发值）时马上买入，或者价格低于（开盘－触发值）时马上卖空。
- 这个系统是反转系统，没有单独止损。也就是说，反向信号也同时就是平仓信号。
`Dual Thrust 策略包含完整的图表显示, 图表动态更新，模板引用等功能, 可做学习模板使用.
ContractTypeIdx 合约品种    下拉框(selected)   当周|次周|季度
MarginLevelIdx  杠杆大小    下拉框(selected)   10|20
NPeriod 计算周期    数字型(number) 4
Ks  上轨系数    数字型(number) 0.5
Kx  下轨系数    数字型(number) 0.5
AmountOP    开仓合约张数  数字型(number) 1
Interval    重试间隔(毫秒)    数字型(number) 2000
LoopInterval    轮询间隔(秒) 数字型(number) 3
PeriodShow  图表最大显示K线柱数  数字型(number) 500
*/

var ChartCfg = {// Highcharts图形库 ，图表对象
    __isStock: true,//false 为普通图表
    title: {//图表的主标题
        text: 'Dual Thrust 上下轨图'  //显示标题文本
    },
    yAxis: {//图表的Y轴
        plotLines: [{//Y轴方向 在X轴上画出一组对象数据，2个结构  第一个 （需要研究）基线
            value: 0,  //初始0值
            color: 'red',  //线的颜色为红色
            width: 2,    //线 宽度为2
            label: {     //线的标签 
                text: '上轨',  //标签上的文本
                align: 'center' //标签的位置  居中
            },
        }, {//第二个 结构  基线
            value: 0, //初始值 0
            color: 'green', //线的颜色为绿色
            width: 2, //线 宽度为2
            label: {//线的标签
                text: '下轨', //标签的文本
                align: 'center' //标签 居中显示
            },
        }]
    },
    series: [{//数据项 索引为0
        type: 'candlestick', // 数据显示 线 类型 ： candlestick 蜡烛图，K线图？
        name: '当前周期', // 数据项 名称
        id: 'primary', // 数据项 id
        data: []    //数据项  初始空
    }, {//索引为1
        type: 'flags', //数据项显示  类型： 标记  在Highcharts 的API查不到。。。重写了？
        onSeries: 'primary', // 标记在id ：primary
        data: [], //数据项  初始空
    }]
};

var STATE_IDLE = 0; //状态 ： 空闲
var STATE_LONG = 1; //状态 ： 多头
var STATE_SHORT = 2; //状态 ： 空头
var State = STATE_IDLE;  //初始State 为空闲

var LastBarTime = 0;
var UpTrack = 0;       //上轨   初始 0 
var BottomTrack = 0;   //下轨   初始 0
var chart = null;      //图表对象  初始  空
var InitAccount = null;   //初始 账户对象 初始 空
var LastAccount = null;   //最后账户对象  初始 空
var Counter = {   //计数器   对象  
    w: 0,         // wins    
    l: 0          //losses
};

function _N(v) {// 转换为保留前4位，向下舍去的 数值
    return Decimal(v).toSD(4, 1).toNumber();
    //Decimal  一个JavaScript的任意精度的十进制 对象类型 
    //toSD:  对于 v 保留 前四位有效数字，之后位数舍去 ，前四位之外 的有效数位为0。该函数返回 一个新的Decimal对象
    //如2.567889    to    2.567  
    //toNumber:  该函数把Decimal 对象 返回为 Number类型，  数字类型。 
}

function GetPosition(posType) {//封装 GetPosition API 获取当前持仓信息  ,参数 posType 合约类型
    var positions = exchange.GetPosition();//调用API 返回一个主交易所持仓信息： Position数组, (BitVC和OKCoin)可以传入一个参数, 指定要获取的合约类型
    for (var i = 0; i < positions.length; i++) {//遍历 Position数组，从i等于0开始 到i等于positions.length-1 
        if (positions[i].Type === posType) {//判断 如果持仓信息中的Type 等于 参数posType 执行return
            return [positions[i].Price, positions[i].Amount];//返回 该持仓类型 的信息， 数组[价格，数量]
        }
    }
    return [0, 0];//没有 对应的 持仓类型  返回[0,0]
}

function CancelPendingOrders() { //取消挂起的  单子
    while (true) {  //无限循环
        var orders = exchange.GetOrders();//获取所有未完成的订单，orders为未完成订单信息的数组
        //导入了 容错模板 ，不用担心 返回NULL 等。。。
        for (var i = 0; i < orders.length; i++) {//遍历 未完成的订单信息
            exchange.CancelOrder(orders[i].Id);// 按索引i 获取订单ID ， 逐个取消订单。
            Sleep(Interval); //按重试间隔 值  暂停一会儿 
        }
        if (orders.length === 0) { //while循环再次获取orders ，判断未完成的订单 数组（orders） 长度为0
            //未完成的订单全部取消，执行break ，跳出 while循环。
            break;
        }
    }
}

function Trade(currentState, nextState) {//交易函数 参数1：当前状态  参数2：下一个状态
    var pfn = nextState === STATE_LONG ? exchange.Buy : exchange.Sell;
    //首先判断nextState是否等于多头状态，是：exchange.Buy 赋给 pfn , 否：exchange.Sell赋给pfn
    if (currentState !== STATE_IDLE) {//判断参数若currentState不等于 空闲状态，执行以下
        exchange.SetDirection(currentState === STATE_LONG ? "closebuy" : "closesell");
        //设置下单类型。      如果当前状态等于 多头   则 卖平仓   否则 买平仓
        //buy买开仓, closebuy卖平仓, sell卖开仓, closesell买平仓
        do {//while..do 循环 先执行do
            pfn(AmountOP);//当pfn=exchange.Buy时， 此处相当于exchange.Buy(AmountOP); 类推exchange.Sell
            //AmountOP开仓合约张数 默认1 ，OKcoin 为张数。
            Sleep(Interval);//暂停一会儿
            CancelPendingOrders();//取消挂起的单子 函数中 逐个取消时也会 Sleep(Interval)
        } while (GetPosition(currentState === STATE_LONG ? PD_LONG : PD_SHORT)[1] > 0);
        //先判断GetPosition()函数的参数，currentState == STATE_LONG 真：参数为 PD_LONG（对象中type属性 表示 多头仓位）
        //假：参数为 PD_SHORT(对象中的type属性 表示 空头仓位),判断完执行GetPosition(参数)，用于获取当前持仓信息，函数返回
        //一个数组，数组索引0：持仓均价，索引1：持仓量，这里判断持仓量大于0的真假。
        var account = exchange.GetAccount();//获取主交易所账户信息

        if (account.Stocks > LastAccount.Stocks) {//此刻账户币数 大于 最后一次更新的账户币数
            Counter.w++;//赢得次数？
        } else {
            Counter.l++;//输的次数？
        }

        LogProfit(_N(account.Stocks - InitAccount.Stocks), "收益率:", _N((account.Stocks - InitAccount.Stocks) * 100 / InitAccount.Stocks) + '%');
        LastAccount = account;//更新 LastAccount 用于下一次交易 盈亏比较
    }
    exchange.SetDirection(nextState === STATE_LONG ? "buy" : "sell");//根据nextState设置下单类型
    while (true) {
        pfn(AmountOP);//下单
        Sleep(Interval);//暂停一会儿
        CancelPendingOrders();//取消挂起的单子
        var pos = GetPosition(nextState === STATE_LONG ? PD_LONG : PD_SHORT);
        //根据nextState  获取 多头持仓信息  或者   空头持仓信息
        if (pos[1] >= AmountOP) {//持仓数量大于等于 开仓合约张数 执行以下  跳出循环
            Log("持仓均价", pos[0], "数量:", pos[1]);
            break;
        }
    }
}

function onTick(exchange) {//根据行情 制定 策略
    var records = exchange.GetRecords();//获取K线 数据 K线周期是 日
    if (!records || records.length <= NPeriod) {//如果records空 或者 长度小于等于计算周期NPeriod（默认4）
        return;//返回空
    }
    var Bar = records[records.length - 1];//获取K线 最后一柱数据赋值给Bar
    if (LastBarTime !== Bar.Time) {//上一次执行时的Bar.Time（现在LastBarTime）不等于 现在Bar.Time 执行以下代码
        var HH = TA.Highest(records, NPeriod, 'High');//返回最近计算周期内所有最高价中的最大值
        var HC = TA.Highest(records, NPeriod, 'Close');//。。。。收盘价的最大值
        var LL = TA.Lowest(records, NPeriod, 'Low');//。。。。最低价的最小值
        var LC = TA.Lowest(records, NPeriod, 'Close');//。。。收盘价的最小值

        var Range = Math.max(HH - LC, HC - LL);//周期内最高价-最低收盘价  、最高收盘价-最低价  两者取最大的

        UpTrack = _N(Bar.Open + (Ks * Range));//计算上轨值：最后柱的开盘价+Range*Ks(Ks是上轨系数：0.5)
        DownTrack = _N(Bar.Open - (Kx * Range));//计算下轨值
        //感觉算法是  根据一个计算周期内的最大波动幅度，预测下一个周期波动范围，如果行情超出这个预测范围，则有机会做多、做空，拙见。
        
        //以下注意：因为当天的K线数据不准确，所以每当添加新数据前要更新添加前的最后一个数据
        if (LastBarTime > 0) {//LastBarTime默认是0，程序初始，第一次跳过这里，运转后再次执行
            var PreBar = records[records.length - 2];//赋值给PreBar，最后柱的前一柱数据
            chart.add(0, [PreBar.Time, PreBar.Open, PreBar.High, PreBar.Low, PreBar.Close], -1);
            //在图表 数据项0索引 用PerBar对象 修改最后一项
        } else {
            for (var i = Math.min(records.length, NPeriod * 3); i > 1; i--) {
        //程序初始画图，如果是计算周期的三倍小于获取的K线数据个数，按3倍计算周期个数开始添加K线数据显示在图表
        //如果K线数据个数小，按K线数据起始数据 添加
                var b = records[records.length - i];//根据i值变化，从最早的数据 遍历赋给b
                chart.add(0, [b.Time, b.Open, b.High, b.Low, b.Close]);//从头添加 数据 显示在图表上
            }
        }
        chart.add(0, [Bar.Time, Bar.Open, Bar.High, Bar.Low, Bar.Close]);
        //添加K线数据  Bar对象在  Series[0]上
        ChartCfg.yAxis.plotLines[0].value = UpTrack;//设置图表对象Y轴 索引为0的基线 的Y轴值为上轨值
        ChartCfg.yAxis.plotLines[1].value = DownTrack;//。。。。。。。的Y轴值为下轨值
        ChartCfg.subtitle = {
            text: '上轨: ' + UpTrack + '  下轨: ' + DownTrack//设置图表的副标题显示上轨值和下轨值
        };
        chart.update(ChartCfg);//更新图表 在Highcharts API里没看到该方法，封装了？
        chart.reset(PeriodShow);// 清空图表 保留500条 显示   PeriodShow默认 500

        LastBarTime = Bar.Time; //更新LastBarTime
    } else {//如果 LastBarTime == Bar.Time
        chart.add(0, [Bar.Time, Bar.Open, Bar.High, Bar.Low, Bar.Close], -1);//用Bar替换最后一项
    }

    LogStatus("Price:", Bar.Close, "Up:", UpTrack, "Down:", DownTrack, "Wins: ", Counter.w, "Losses:", Counter.l, "Date:", new Date());
    //更新 机器人当前状态信息
    var msg;//信息变量  字符串
    if (State === STATE_IDLE || State === STATE_SHORT) {//如果状态为空闲   或  空头
        if (Bar.Close >= UpTrack) {//如果当前最后一个K线数据的收盘价大于等于上轨值，执行以下
            msg  = '做多 触发价: ' + Bar.Close + ' 上轨:' + UpTrack;
            Log(msg);//输出 做多  触发价  值   上轨值
            Trade(State, STATE_LONG);//交易函数（做多） 当前状态 空头 或 空闲，下一个状态 多头
            State = STATE_LONG;//把状态设置成  多头
            chart.add(1, {x:Bar.Time, color: 'red', shape: 'flag', title: '多', text: msg});
            //在图表数据项索引1  添加数据： flag 型数据  位置在X轴值为 Bar.Time的地方（触发做多的位置）
        }
    }

    if (State === STATE_IDLE || State === STATE_LONG) {//状态为空闲 或  多头
        if (Bar.Close <= DownTrack) {//如果 K线最后的数据 收盘价小于等于下轨值 执行以下 
            msg = '做空 触发价: ' + Bar.Close + ' 下轨:' + DownTrack;//设置做空 信息
            Log(msg);//显示信息
            Trade(State, STATE_SHORT);//交易 当前状态空闲 或 多头，下一个状态空头
            chart.add(1, {x:Bar.Time, color: 'green', shape: 'circlepin', title: '空', text: msg});
            //添加标记
            State = STATE_SHORT;//设置状态  空头
        }
    }
}

function onexit() {//扫尾， 
    var pos = exchange.GetPosition();//获取持仓信息
    if (pos.length > 0) {
        Log("警告, 退出时有持仓", pos);
    }
}

function main() {
    if (exchange.GetName() !== 'Futures_OKCoin') {//主交易所账户如果不是 OKCoin期货
        throw "只支持OKCoin期货";  //抛出错误
    }
    exchange.SetRate(1);//禁用汇率转换
    exchange.SetContractType(["this_week", "next_week", "quarter"][ContractTypeIdx]);
    //设置合约类型      参数 这种方法 数组索引的用法，以前也没见过。ContractTypeIdx是全局变量 实际是下拉框的索引值
    exchange.SetMarginLevel([10, 20][MarginLevelIdx]);
    //设置杠杆           参数同上类似  MarginLevelIdx全局变量
    if (exchange.GetPosition().length > 0) {//按照程序逻辑   策略  启动时 不持仓
        throw "策略启动前不能有持仓."; //抛出错误信息
    }

    CancelPendingOrders();//取消所有挂起的单子

    InitAccount = LastAccount = exchange.GetAccount();//记录初始账户信息
    LoopInterval = Math.min(1, LoopInterval);//轮询间隔 取值 1   这里？不懂
    Log('交易平台:', exchange.GetName(), InitAccount);
    LogStatus("Ready...");

    LogProfitReset();//清空 收益 日志
    chart = Chart(ChartCfg); //用ChartCfg对象做参数  初始化 图表对象
    chart.reset();//清空图表数据

    LoopInterval = Math.max(LoopInterval, 1);//这个 LoopInterval 只能是1
    while (true) {
        onTick(exchange);//扫描行情
        Sleep(LoopInterval * 1000);//间隔一定时间
    }
}