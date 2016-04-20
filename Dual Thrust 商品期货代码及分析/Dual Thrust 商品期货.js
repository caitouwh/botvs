/*
> 基本原理

- 在当天收盘，计算两个值： 最高价－收盘价，和收盘价－最低价。然后取这两个值较大的那个，乘以k值，结果称为触发值。
- 在第二天开盘，记录开盘价，然后在价格超过（开盘＋触发值）时马上买入，或者价格低于（开盘－触发值）时马上卖空。
- 这个系统是反转系统，没有单独止损。也就是说，反向信号也同时就是平仓信号。

> 图解

 https://dn-filebox.qbox.me/ab06814528c0ae8c54c6bebaea4438325968fbe5.jpg 

`Dual Thrust 策略包含完整的图表显示, 图表动态更新，模板引用等功能, 可做学习模板使用.`

策略的详细介绍 : http://xueqiu.com/5256769224/32429363
*/
/*
ContractTypeName      合约品种             字符串(string)         MA609
NPeriod               计算周期             数字型(number)         4
Ks                    上轨系数             数字型(number)         0.5
Kx                    下轨系数             数字型(number)         0.5
AmountOP              开仓合约张数         数字型(number)         1
Interval              重试间隔(毫秒)       数字型(number)         2000
LoopInterval          轮询间隔(秒)         数字型(number)         3
PeriodShow            图表最大显示K线柱数  数字型(number)         500
NotifyWX              下单微信通知         布尔型(true/false)     true
*/
var ChartCfg = {//图表对象API文档： http://api.highcharts.com/highcharts#series<column>    、   http://www.hcharts.cn/docs/index.php?doc=basic-compose
    __isStock: true,//false 为 普通图表
    title: {
        text: 'Dual Thrust 上下轨图'//图表标题
    },
    yAxis: {// Y轴 
        plotLines: [{// 线 2个 对象 ， 第一个  上轨  第二个 下轨
            value: 0,//初始 Y值 0
            color: 'red', //红色
            width: 2,//线的 宽度
            label: {//标签
                text: '上轨', //文本 显示
                align: 'center'//显示位置
            },
        }, {//下轨
            value: 0,//初始值 0
            color: 'green', //绿色
            width: 2,//宽度
            label: {// 标线
                text: '下轨', //显示文本
                align: 'center' // 在中间显示
            },
        }]
    },
    series: [{//数据显示   数组第一个 索引 0
        type: 'candlestick',//类型 蜡烛图  
        name: '当前周期', //数据项显示 的  名称
        id: 'primary',//ID，后面有用。
        data: [] // 数据块  数组
    }, {//数组第二个   索引 1
        type: 'flags', //标记
        onSeries: 'primary', // 在ID 为  primary 的数据上
        data: [], //数据块
    }]
};

var STATE_IDLE = 0;// 空闲状态
var STATE_LONG = 1;//多头 状态
var STATE_SHORT = 2;//空头 状态
var State = STATE_IDLE; // 初始状态为   空闲状态

var LastBarTime = 0; //最后一柱  时间   初始  0
var UpTrack = 0;// 上轨 值
var BottomTrack = 0; //下轨  值
var chart = null; //图表对象  变量  初始  空
var Counter = { // 计数器：   w  赢  l 输
    w: 0,
    l: 0
};

var manager = null; // 处理者？  交易管理对象
var logSuffix = NotifyWX ? '@' : '';//日志 后缀  用于微信推送

function onTick(exchange) {//行情扫描
    if (!manager) {//第一次 会这行这里  manager 为 unll时
        if (_C(exchange.GetPosition).length > 0) {//判断  有没有 持仓信息
            throw "策略启动前不能有持仓."; //抛出错误
        }
        Log('交易平台:', exchange.GetName(), _C(exchange.GetAccount));//输出 平台 、  账户 信息
        var insDetail = _C(exchange.SetContractType, ContractTypeName);//设置合约类型 ，返回合约信息，详细信息。
        Log("合约", insDetail.InstrumentName, "一手", insDetail.VolumeMultiple, "份, 最大下单量", insDetail.MaxLimitOrderVolume, "保证金率:", insDetail.LongMarginRatio.toFixed(4), insDetail.ShortMarginRatio.toFixed(4), "交割日期", insDetail.StartDelivDate);
        //输出合约信息： 合约名称、一手多少份、最大下单量、保证金率、交割日期。
        manager = $.NewPositionManager();//调用 模板 的导出函数   生成新 交易管理对象
    }

    var records = _C(exchange.GetRecords);//获取 K线 数据
    if (!records || records.length <= NPeriod) {//如果  获取的K线周期 为null  或   长度小于等于 计算周期
        return; //返回 null
    }
    var Bar = records[records.length - 1];//从K线 数据数组 中取出 最后 一柱
    if (LastBarTime !== Bar.Time) {// 如果 记录的最后一柱 的 时间戳  不等于 刚才获取的Bar 的时间戳，证明K线周期更新，Bar为最新的
        var HH = TA.Highest(records, NPeriod, 'High');//调用指标库函数，获取 计算周期内 records的High属性的 最高价
        var HC = TA.Highest(records, NPeriod, 'Close');//调用指标库函数，获取 计算周期内 records的Close属性的 最高价
        var LL = TA.Lowest(records, NPeriod, 'Low');//调用指标库函数，获取 计算周期内 records的Low属性的 最低价
        var LC = TA.Lowest(records, NPeriod, 'Close');//调用指标库函数，获取 计算周期内 records的Close属性的 最低价

        var Range = Math.max(HH - LC, HC - LL);//获取最大的范围，

        UpTrack = _N(Bar.Open + (Ks * Range));//计算 上轨
        DownTrack = _N(Bar.Open - (Kx * Range));//计算 下轨
        if (LastBarTime > 0) {//程序 开始 时  LastBarTime 为0 ， 不会执行，之后 再次 开始执行
            var PreBar = records[records.length - 2];//获取前一柱
            chart.add(0, [PreBar.Time, PreBar.Open, PreBar.High, PreBar.Low, PreBar.Close], -1);//在图表数据0索引数据项最后更新PreBar
        } else {//开始时执行
            for (var i = Math.min(records.length, NPeriod * 3); i > 1; i--) {//最大取 三倍计算周期 遍历 records
                var b = records[records.length - i]; //按i值变化，  records 从前向后 依次取出bar
                chart.add(0, [b.Time, b.Open, b.High, b.Low, b.Close]); //数据索引0 项 最后  添加（与更新不同） 数据，直到添加到 length-2
            }
        }
        chart.add(0, [Bar.Time, Bar.Open, Bar.High, Bar.Low, Bar.Close]);//添加当前bar
        ChartCfg.yAxis.plotLines[0].value = UpTrack; //更新 图表对象 线索引为0 的值（上轨值，根据此值显示）
        ChartCfg.yAxis.plotLines[1].value = DownTrack; //更新 图表对象 线索引为1 的值（下轨值）
        ChartCfg.subtitle = {//更新副标题
            text: '上轨: ' + UpTrack + '  下轨: ' + DownTrack//显示 上轨 下轨 的 数值
        };
        chart.update(ChartCfg);//用图表对象 更新图表
        chart.reset(PeriodShow);//按参数  ，  重置图表（保留一定条数）

        LastBarTime = Bar.Time;//更新 LsatBarTime 为此刻的 最新K线时间戳，用于对比下一次循环 判断K线是否更新
    } else {//如果 K线周期  没更新
        chart.add(0, [Bar.Time, Bar.Open, Bar.High, Bar.Low, Bar.Close], -1);//用此刻的最后一柱  更新图表上的最后一柱
    }

    LogStatus("Price:", Bar.Close, "Up:", UpTrack, "Down:", DownTrack, "Wins: ", Counter.w, "Losses:", Counter.l, "Date:", new Date());
    //更新 机器人  状态
    var msg;//定义消息
    if (State === STATE_IDLE || State === STATE_SHORT) {//如果状态为 空闲  或  空头
        if (Bar.Close >= UpTrack) {//此刻K线周期收盘价 大于等于 上轨值
            msg  = '做多 触发价: ' + Bar.Close + ' 上轨:' + UpTrack; //消息字符串 生成
            if (State !== STATE_IDLE) {//如果 状态 不等于 空闲， 为空头
                manager.Cover(ContractTypeName);//按合约品种  平空仓
                var profit = manager.Profit();// 获得盈亏 数据
                LogProfit(profit);//显示 盈亏
                msg += ' 平仓利润: ' + profit;//更新  消息字符串为  平仓信息
            }
            Log(msg + logSuffix);//输出消息，  可以推送
            manager.OpenLong(ContractTypeName, AmountOP);//空闲状态、或 平仓完成后 开多仓
            State = STATE_LONG;//更新 状态为  多头。
            chart.add(1, {x:Bar.Time, color: 'red', shape: 'flag', title: '多', text: msg});
            //在数据项  索引1 添加  数据，图标上 显示 为 标签
        }
    }

    if (State === STATE_IDLE || State === STATE_LONG) {//状态为空闲  或  多头
        if (Bar.Close <= DownTrack) { //如果 此刻K线 周期收盘价 小于等于  下轨
            msg = '做空 触发价: ' + Bar.Close + ' 下轨:' + DownTrack; //生成消息字符串
            if (State !== STATE_IDLE) {// 如果 状态为  空闲
                manager.Cover(ContractTypeName); //平多仓
                var profit = manager.Profit();//获取 平仓 盈亏
                LogProfit(profit);//输出  盈亏
                msg += ' 平仓利润: ' + profit;//更新 为  平仓信息
            }
            Log(msg + logSuffix);//输出 消息字符串
            manager.OpenShort(ContractTypeName, AmountOP); // 开空仓
            chart.add(1, {x:Bar.Time, color: 'green', shape: 'circlepin', title: '空', text: msg});//添加标签
            State = STATE_SHORT;//更新状态 为 空头
        }
    }
}

function onexit() {//扫尾 函数
    var pos = _C(exchange.GetPosition);//获取当前持仓信息
    if (pos.length > 0) {// pos数组 长度 大于0 ，证明 有持仓信息
        Log("警告, 退出时有持仓", pos); //输出 提示信息
    }
}

function main() {//主函数
    if (exchange.GetName() !== 'Futures_CTP') {//获取交易所 名称  ，如果 不等于 Futures_CTP 抛出错误
        throw "只支持传统商品期货(CTP)";  // 抛出
    }
    SetErrorFilter("login|ready");//  过滤 错误信息 

    LogStatus("Ready...");//更新 机器人 状态  准备
    LogProfitReset();//重置盈亏
    chart = Chart(ChartCfg);//调用 画图API  用 ChartCfg 对象初始化 返回。
    chart.reset();//图表对象 重置

    LoopInterval = Math.max(LoopInterval, 1);//设置 LoopInterval 最小值为1
    while (true) { //while 循环 启动  就 一直执行
        if (exchange.IO("status")) { //调用  交易所 的status API ， 成功返回   执行以下
            onTick(exchange); // 扫描市场
        } else {//否则
            LogStatus("未登录状态"); // 输出状态  未登录
        }
        Sleep(LoopInterval * 1000);//轮询
    }
}