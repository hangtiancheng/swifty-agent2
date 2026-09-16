// Authoritative topic taxonomy: 17 classes shared by data, inference, evaluation and APIs.
// Tuple order is the label id; severity drives the tolerance gate per class.

export interface TopicClass {
  name: string;
  boundary: string;
  examples: string[];
  severity: string;
}

export const TOPIC_CLASSES: readonly TopicClass[] = [
  { name: "退换货", boundary: "退货、换货、退款怎么办;修归保修维修,退归这里", examples: ["退货", "退款", "退钱", "想退了", "七天无理由还能退不"], severity: "严" },
  { name: "物流", boundary: "货走到哪了、什么时候送到;运费的钱事归运费", examples: ["快递", "发货", "到哪了", "怎么还不动", "海外直邮"], severity: "严" },
  { name: "尺码", boundary: "大小、码数合不合适", examples: ["猫窝买大了", "猫别墅尺寸", "项圈偏码", "适合几斤的猫"], severity: "严" },
  { name: "发票", boundary: "开票、抬头、报销凭证", examples: ["开发票", "发票抬头开错了", "能开增值税发票吗", "合并开票"], severity: "严" },
  { name: "质量问题", boundary: "商品本身的毛病", examples: ["开胶", "破了个洞", "有瑕疵", "猫砂盆电机坏了"], severity: "严" },
  { name: "运费", boundary: "运费谁出、运费险理赔;管的是钱,货走到哪了归物流", examples: ["包邮吗", "退货运费谁承担", "运费险怎么赔"], severity: "中" },
  { name: "优惠活动", boundary: "券和活动怎么用、能不能叠", examples: ["优惠券", "满减", "活动价", "能叠加用吗", "双十一有活动吗"], severity: "中" },
  { name: "价保", boundary: "买完降价了补不补差价", examples: ["刚买就降价了", "能补差价吗", "保价期多久"], severity: "中" },
  { name: "支付", boundary: "付款环节出的问题", examples: ["付不了款", "花呗分期", "扣了两次钱", "货到付款", "数字人民币"], severity: "中" },
  { name: "订单修改", boundary: "下单之后改信息、取消订单", examples: ["改地址", "改电话号码", "订单还能取消吗"], severity: "中" },
  { name: "库存补货", boundary: "有没有货、什么时候补", examples: ["有货吗", "断货了", "什么时候补货", "有现货吗"], severity: "中" },
  { name: "商品信息", boundary: "材质、功能、用法", examples: ["什么材质", "怎么洗", "冻干怎么保存", "废砂盒多久倒", "猫粮怎么选"], severity: "中" },
  { name: "保修维修", boundary: "保修期限、维修换新;修归这里,退归退换货", examples: ["保修多久", "坏了能修吗", "能换新吗"], severity: "中" },
  { name: "账号", boundary: "登录、绑定、账号安全", examples: ["登录不上", "忘了密码", "换绑手机号", "注销账号"], severity: "宽" },
  { name: "会员积分", boundary: "会员权益、积分怎么用", examples: ["积分怎么用", "会员几级", "积分能抵钱吗"], severity: "宽" },
  { name: "评价", boundary: "评价、晒单的规则", examples: ["评价怎么改", "追评在哪写", "晒单有奖励吗"], severity: "宽" },
  { name: "其他", boundary: "上面都对不上的,先兜底", examples: ["闲聊", "转人工", "客服几点上班"], severity: "宽" },
];

export const TOPIC_NAMES: readonly string[] = TOPIC_CLASSES.map((c) => c.name);
export const LABEL2ID: Record<string, number> = Object.fromEntries(TOPIC_NAMES.map((n, i) => [n, i]));
export const ID2LABEL: Record<number, string> = Object.fromEntries(TOPIC_NAMES.map((n, i) => [i, n]));
export const NUM_CLASSES = TOPIC_CLASSES.length;
export const SEVERITY: Record<string, string> = Object.fromEntries(TOPIC_CLASSES.map((c) => [c.name, c.severity]));

export function terminologyTable(): string {
  return TOPIC_CLASSES.map((c) => `- ${c.name}:${c.boundary}(示例:${c.examples.join("、")})`).join("\n");
}
