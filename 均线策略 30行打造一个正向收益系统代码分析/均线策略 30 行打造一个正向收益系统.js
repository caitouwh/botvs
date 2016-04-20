/*
FastPeriod  入市快线周期  数字型(number)       3 
SlowPeriod  入市慢线周期  数字型(number)       7
EnterPeriod 入市观察期   数字型(number)        3
ExitFastPeriod  离市快线周期  数字型(number)   3
ExitSlowPeriod  离市慢线周期  数字型(number)   7
ExitPeriod  离市观察期   数字型(number)        1
PositionRatio   仓位比例    数字型(number)     0.8
Interval    轮询周期(秒) 数字型(number)        10
*/
//导入了 交易类库  方便策略编写，  不用为 是否买到  是否卖出等 挂单 烦恼了。
function main() {
    var STATE_IDLE  = -1;//空闲状态
    var state = STATE_IDLE;//初始化  状态 为 空闲
    var opAmount = 0;//交易量初始为0
    var initAccount = $.GetAccount();//交易模板的导出函数， 获得账户状态，保存策略运行前账户初始状态。
    Log(initAccount);//输出初始账户信息
    while (true) {//循环
        if (state === STATE_IDLE) {//判断状态是否 为空闲 触发开仓的第一个条件
            var n = $.Cross(FastPeriod, SlowPeriod);//模板函数返回EMA指标快线、慢线交叉结果
            if (Math.abs(n) >= EnterPeriod) {//触发开仓的第二个条件
            //判断n的绝对值 是否大于等于 入市观察期 默认2，这个判断已经排除n=0的情况了
                opAmount = parseFloat((initAccount.Stocks * PositionRatio).toFixed(3));
              //交易数量opAmount
              //initAccount.Stocks * PositionRatio ：账户币数 * 仓位比例  结果是Number类型
              //注意Number的成员函数toFixed函数，功能是把调用它的Number按参数保留
              //小数位四舍五入 返回的是一个字符串，，parseFloat函数作用为解析一个字符串返回浮点数。
                var obj = n > 0 ? $.Buy(opAmount) : $.Sell(opAmount);
              //判断是否  快线EMA 上穿 慢线EMA 多头 信号，n>0为真执行$.Buy，假执行$.Sell
              //返回一个结构  包括 交易价格  交易量
                if (obj) {//obj对象不为空 执行以下
                    opAmount = obj.amount;//完成的成交量 更新给 操作量opAmount
                    state = n > 0 ? PD_LONG : PD_SHORT;//当前做多 设置状态为多头持仓，否则设置状态为空头持仓
                    Log("开仓详情", obj, "交叉周期", n);//输出开仓情况
                }
            }
        } else {//state 为非空闲状态 处理 平仓检测
            var n = $.Cross(ExitFastPeriod, ExitSlowPeriod);//检测行情 返回指标交叉结果
            if (Math.abs(n) >= ExitPeriod && ((state === PD_LONG && n < 0) || (state === PD_SHORT && n > 0))) {
    //这个判断条件有点长，先看Math.abs(n) >= ExitPeriod，n的绝对值大于等于 离市观察期 这是触发条件1，并且
    //(state === PD_LONG && n < 0)、(state === PD_SHORT && n > 0)两者中至少有个为真
    //(state === PD_LONG && n < 0)为真： 即当前状态多头持仓并且快线EMA下穿慢线EMA
    //(state === PD_SHORT && n > 0) 为真： 即当前状态空头持仓（现货做空）并且快线EMA上穿慢线EMA
                var obj = state === PD_LONG ? $.Sell(opAmount) : $.Buy(opAmount);
                //根据当前状态，state为多头 执行多头平仓，空头 执行 空头平仓 （买平仓）
                state = STATE_IDLE;//平仓完毕  更新状态为 空闲
                var nowAccount = $.GetAccount();//获取此刻账户信息
                LogProfit(nowAccount.Balance - initAccount.Balance, '钱:', nowAccount.Balance, '币:', nowAccount.Stocks, '平仓详情:', obj, "交叉周期", n);
                //日志收益，显示 平仓收益、账户 钱 、币 信息 平仓详情、交叉周期 
            }
        }
        Sleep(Interval*1000);//暂停10秒   轮询周期10秒
    }
}