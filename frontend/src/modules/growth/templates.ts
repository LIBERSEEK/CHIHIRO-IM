import type { GrowthRuleGroup } from './client'

export interface GrowthCommentTemplate {
  id: string
  name: string
  groups: GrowthRuleGroup[]
}

export const GROWTH_COMMENT_TEMPLATES = [
  {
    id: "01",
    name: "01-美食餐饮",
    groups: [
      {
        id: "food_restaurant_001",
        name: "餐厅探店",
        type: "manual",
        comments: [],
        children: [
          {
            id: "food_restaurant_001_1",
            name: "火锅烧烤",
            type: "manual",
            comments: [ "这个火锅看着太诱人了🍲请问锅底是什么口味的？", "烧烤看着就很香！这家店排队吗？", "收藏了！下次聚餐就来这家💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "火锅",
              },
              {
                field: "videoDesc",
                keyword: "烧烤",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "food_restaurant_001_2",
            name: "日料西餐",
            type: "manual",
            comments: [ "这个摆盘太精致了✨人均多少？", "环境看着很高级，适合商务宴请吗？", "食材新鲜吗？值得专程去吗？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "日料",
              },
              {
                field: "videoDesc",
                keyword: "西餐",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "探店",
          },
          {
            field: "videoDesc",
            keyword: "餐厅",
          },
          {
            field: "videoTag",
            keyword: "美食探店",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "food_cooking_002",
        name: "烹饪教学",
        type: "manual",
        comments: [],
        children: [
          {
            id: "food_cooking_002_1",
            name: "家常菜",
            type: "manual",
            comments: [ "这个太简单了！今晚就试试👨‍🍳", "家常菜就该这样，实用！", "收藏了！每天换着花样做给家人吃❤️" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "家常",
              },
              {
                field: "videoDesc",
                keyword: "简单",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "food_cooking_002_2",
            name: "烘焙甜品",
            type: "manual",
            comments: [ "太治愈了😍烤箱温度和时间能再说一下吗？", "这个造型好可爱！新手能做吗？", "看着就很好吃！请问用的什么牌子的面粉？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "烘焙",
              },
              {
                field: "videoDesc",
                keyword: "甜品",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "教程",
          },
          {
            field: "videoDesc",
            keyword: "做法",
          },
          {
            field: "videoTag",
            keyword: "美食教程",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "02",
    name: "02-美妆护肤",
    groups: [
      {
        id: "beauty_makeup_001",
        name: "美妆教程",
        type: "manual",
        comments: [],
        children: [
          {
            id: "beauty_makeup_001_1",
            name: "日常淡妆",
            type: "manual",
            comments: [ "这个淡妆太自然了！💄适合上班吗？", "手法好轻！新手也能学会吗？", "收藏了！明天就这样画✨" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "日常",
              },
              {
                field: "videoDesc",
                keyword: "淡妆",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "beauty_makeup_001_2",
            name: "特殊场合",
            type: "manual",
            comments: [ "这个妆容好惊艳！😍持久度怎么样？", "参加婚礼就画这个！太适合了💕", "请问用了什么定妆产品？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "婚礼",
              },
              {
                field: "videoDesc",
                keyword: "派对",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "妆容",
          },
          {
            field: "videoDesc",
            keyword: "化妆",
          },
          {
            field: "videoTag",
            keyword: "美妆教程",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "beauty_skincare_002",
        name: "护肤分享",
        type: "manual",
        comments: [],
        children: [
          {
            id: "beauty_skincare_002_1",
            name: "基础护肤",
            type: "manual",
            comments: [ "这个产品我也在用！效果确实不错👍", "敏感肌可以用吗？会不会刺激？", "种草了！这个价位真的很良心💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "水乳",
              },
              {
                field: "videoDesc",
                keyword: "精华",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "beauty_skincare_002_2",
            name: "功效护肤",
            type: "manual",
            comments: [ "用了多久看到效果的？想入手试试✨", "请问干皮适合吗？会不会太油腻？", "效果怎么样？值得入手吗？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "美白",
              },
              {
                field: "videoDesc",
                keyword: "抗衰",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "护肤",
          },
          {
            field: "videoDesc",
            keyword: "精华",
          },
          {
            field: "videoTag",
            keyword: "护肤",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "03",
    name: "03-健身运动",
    groups: [
      {
        id: "fitness_workout_001",
        name: "健身教学",
        type: "manual",
        comments: [],
        children: [
          {
            id: "fitness_workout_001_1",
            name: "力量训练",
            type: "manual",
            comments: [ "这个动作标准！💪跟着练了一周效果明显", "请问每天要练多久才能看到效果？", "动作讲解很详细👍收藏了每天打卡！" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "力量",
              },
              {
                field: "videoDesc",
                keyword: "胸肌",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "fitness_workout_001_2",
            name: "有氧运动",
            type: "manual",
            comments: [ "这组动作太实用了！在家也能练🔥", "新手能跟上吗？强度会不会太大？", "收藏了！每天坚持一小时✨" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "跑步",
              },
              {
                field: "videoDesc",
                keyword: "有氧",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "健身",
          },
          {
            field: "videoDesc",
            keyword: "练",
          },
          {
            field: "videoTag",
            keyword: "健身",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "fitness_weightloss_002",
        name: "减肥瘦身",
        type: "manual",
        comments: [],
        children: [
          {
            id: "fitness_weightloss_002_1",
            name: "饮食管理",
            type: "manual",
            comments: [ "饮食也要控制吗？能分享一下食谱吗？🥗", "这个食谱好健康！热量大概多少？", "收藏了！明天就按这个吃💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "饮食",
              },
              {
                field: "videoDesc",
                keyword: "食谱",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "fitness_weightloss_002_2",
            name: "成功案例",
            type: "manual",
            comments: [ "太励志了！请问瘦了多少斤？用了多久？", "看到你的变化真的很受鼓舞！我也要加油💪", "瘦下来真的太美了✨能详细说说方法吗？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "成功",
              },
              {
                field: "videoDesc",
                keyword: "前后对比",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "减肥",
          },
          {
            field: "videoDesc",
            keyword: "瘦",
          },
          {
            field: "videoTag",
            keyword: "减肥",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "04",
    name: "04-电商带货",
    groups: [
      {
        id: "ecommerce_clothing_001",
        name: "服装穿搭",
        type: "manual",
        comments: [],
        children: [
          {
            id: "ecommerce_clothing_001_1",
            name: "日常通勤",
            type: "manual",
            comments: [ "这套穿搭太好看了！👗请问链接能分享吗？", "好会穿！适合上班族👍", "收藏了！这个风格太适合我了😍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "通勤",
              },
              {
                field: "videoDesc",
                keyword: "上班",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "ecommerce_clothing_001_2",
            name: "特殊场合",
            type: "manual",
            comments: [ "这个配色我太爱了💕周末就这么穿！", "身材比例也太好了吧！请问多高多重？", "适合学生党吗？价格大概多少？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "约会",
              },
              {
                field: "videoDesc",
                keyword: "聚会",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "穿搭",
          },
          {
            field: "videoDesc",
            keyword: "outfit",
          },
          {
            field: "videoTag",
            keyword: "穿搭",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "ecommerce_haul_002",
        name: "好物分享",
        type: "manual",
        comments: [],
        children: [
          {
            id: "ecommerce_haul_002_1",
            name: "生活用品",
            type: "manual",
            comments: [ "第三个真的太实用了！已下单✨", "质量怎么样？用了多久了？", "价格美丽！性价比超高👍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "生活",
              },
              {
                field: "videoDesc",
                keyword: "日用",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "ecommerce_haul_002_2",
            name: "美妆数码",
            type: "manual",
            comments: [ "种草了好几个！钱包要捂不住了💸", "求购买链接🙏真的太需要了！", "这个真的好用！我也买了💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "美妆",
              },
              {
                field: "videoDesc",
                keyword: "数码",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "好物",
          },
          {
            field: "videoDesc",
            keyword: "推荐",
          },
          {
            field: "videoTag",
            keyword: "好物推荐",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "05",
    name: "05-教育培训",
    groups: [
      {
        id: "education_learning_001",
        name: "学习方法",
        type: "manual",
        comments: [],
        children: [
          {
            id: "education_learning_001_1",
            name: "考试备考",
            type: "manual",
            comments: [ "这个方法太实用了！📚收藏了马上试试！", "讲得太清楚了！终于找到适合我的方法了👍", "请问适合高中生吗？备考阶段能用吗？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "考试",
              },
              {
                field: "videoDesc",
                keyword: "备考",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "education_learning_001_2",
            name: "日常学习",
            type: "manual",
            comments: [ "感谢分享！这个技巧我一定要试试✨", "已经分享给孩子了！希望对他有帮助💪", "收藏了！这个方法很科学💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "效率",
              },
              {
                field: "videoDesc",
                keyword: "专注",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "学习",
          },
          {
            field: "videoDesc",
            keyword: "方法",
          },
          {
            field: "videoTag",
            keyword: "学习方法",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "education_skills_002",
        name: "技能提升",
        type: "manual",
        comments: [],
        children: [
          {
            id: "education_skills_002_1",
            name: "Office技能",
            type: "manual",
            comments: [ "干货满满！这个技能正是我需要的💼", "零基础能学会吗？大概需要多久？", "学到了！对工作真的很有帮助👏" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "Excel",
              },
              {
                field: "videoDesc",
                keyword: "PPT",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "education_skills_002_2",
            name: "职业技能",
            type: "manual",
            comments: [ "讲解很专业！请问有完整课程吗？", "收藏了！准备好好学习一下🎯", "这个技能很有用！谢谢分享✨" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "设计",
              },
              {
                field: "videoDesc",
                keyword: "编程",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "技能",
          },
          {
            field: "videoDesc",
            keyword: "教程",
          },
          {
            field: "videoTag",
            keyword: "职场",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "06",
    name: "06-母婴育儿",
    groups: [
      {
        id: "parenting_baby_001",
        name: "育儿知识",
        type: "manual",
        comments: [],
        children: [
          {
            id: "parenting_baby_001_1",
            name: "婴儿护理",
            type: "manual",
            comments: [ "这个方法太实用了！👶我家宝宝也是这样！", "请问宝宝多大适合？我家刚6个月", "学到了！之前一直不知道该怎么做" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "护理",
              },
              {
                field: "videoDesc",
                keyword: "婴儿",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "parenting_baby_001_2",
            name: "儿童教育",
            type: "manual",
            comments: [ "太感谢了！正好遇到这个问题💕", "收藏了！新手妈妈真的太需要这些知识了", "这个方法很科学！马上尝试✨" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "教育",
              },
              {
                field: "videoDesc",
                keyword: "儿童",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "育儿",
          },
          {
            field: "videoDesc",
            keyword: "宝宝",
          },
          {
            field: "videoTag",
            keyword: "育儿",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "parenting_products_002",
        name: "母婴好物",
        type: "manual",
        comments: [],
        children: [
          {
            id: "parenting_products_002_1",
            name: "宝宝用品",
            type: "manual",
            comments: [ "这个太实用了！请问在哪买的？🛒", "质量怎么样？安全吗？宝宝能用吗？", "种草了！价格大概多少？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "尿裤",
              },
              {
                field: "videoDesc",
                keyword: "奶瓶",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "parenting_products_002_2",
            name: "妈妈用品",
            type: "manual",
            comments: [ "我也买了！确实很好用👍", "已加购物车！看着就很不错✨", "请问孕期可以用吗？有没有副作用？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "妈妈",
              },
              {
                field: "videoDesc",
                keyword: "孕妇",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "好物",
          },
          {
            field: "videoDesc",
            keyword: "推荐",
          },
          {
            field: "videoTag",
            keyword: "母婴",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "07",
    name: "07-旅游出行",
    groups: [
      {
        id: "travel_guide_001",
        name: "旅游攻略",
        type: "manual",
        comments: [],
        children: [
          {
            id: "travel_guide_001_1",
            name: "国内游",
            type: "manual",
            comments: [ "太实用了！🗺️收藏了下个月就去！", "请问总共花费多少？人均预算多少？", "这个路线规划得很合理！感谢分享👍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "国内",
              },
              {
                field: "videoDesc",
                keyword: "周边",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "travel_guide_001_2",
            name: "出境游",
            type: "manual",
            comments: [ "景色太美了😍请问最佳旅游季节是？", "攻略很详细！已经转发给朋友了💕", "签证好办吗？需要准备什么材料？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "出境",
              },
              {
                field: "videoDesc",
                keyword: "海外",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "攻略",
          },
          {
            field: "videoDesc",
            keyword: "旅游",
          },
          {
            field: "videoTag",
            keyword: "旅游攻略",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "travel_destination_002",
        name: "景点推荐",
        type: "manual",
        comments: [],
        children: [
          {
            id: "travel_destination_002_1",
            name: "自然风光",
            type: "manual",
            comments: [ "这个地方太美了！📸请问在哪个城市？", "看着就很舒服！适合亲子游吗？", "收藏了！下次一定要去打卡✨" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "风景",
              },
              {
                field: "videoDesc",
                keyword: "山水",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "travel_destination_002_2",
            name: "人文古迹",
            type: "manual",
            comments: [ "门票贵吗？需要提前预约吗？", "你拍的照片太好看了！用的什么设备？", "这个地方很有历史感！值得一去👍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "古镇",
              },
              {
                field: "videoDesc",
                keyword: "历史",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "景点",
          },
          {
            field: "videoDesc",
            keyword: "打卡",
          },
          {
            field: "videoTag",
            keyword: "旅行",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "08",
    name: "08-汽车行业",
    groups: [
      {
        id: "auto_review_001",
        name: "汽车评测",
        type: "manual",
        comments: [],
        children: [
          {
            id: "auto_review_001_1",
            name: "燃油车",
            type: "manual",
            comments: [ "评测很专业！🚗这款车我也在考虑", "请问油耗实际表现怎么样？", "性价比确实不错👍准备去试驾看看" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "燃油",
              },
              {
                field: "videoDesc",
                keyword: "汽油",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "auto_review_001_2",
            name: "新能源车",
            type: "manual",
            comments: [ "空间够用吗？后排坐三个人挤不挤？", "这个配置在同级别里算好的吗？", "续航表现怎么样？冬天会打折扣吗？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "电动",
              },
              {
                field: "videoDesc",
                keyword: "新能源",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "评测",
          },
          {
            field: "videoDesc",
            keyword: "试驾",
          },
          {
            field: "videoTag",
            keyword: "汽车",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "auto_tips_002",
        name: "用车技巧",
        type: "manual",
        comments: [],
        children: [
          {
            id: "auto_tips_002_1",
            name: "驾驶技巧",
            type: "manual",
            comments: [ "学到了！这个技巧太实用了💡", "新手司机表示很有帮助！感谢分享👍", "收藏了！这些知识都很重要" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "驾驶",
              },
              {
                field: "videoDesc",
                keyword: "开车",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "auto_tips_002_2",
            name: "维修保养",
            type: "manual",
            comments: [ "请问多久保养一次比较合适？", "讲解很清楚！马上去试试✨", "这个能省不少钱！实用👍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "保养",
              },
              {
                field: "videoDesc",
                keyword: "维修",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "技巧",
          },
          {
            field: "videoDesc",
            keyword: "保养",
          },
          {
            field: "videoTag",
            keyword: "用车",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "09",
    name: "09-家居装修",
    groups: [
      {
        id: "home_decoration_001",
        name: "装修设计",
        type: "manual",
        comments: [],
        children: [
          {
            id: "home_decoration_001_1",
            name: "现代简约",
            type: "manual",
            comments: [ "这个设计太赞了！🏠请问预算大概多少？", "收藏了！我家也准备这样装✨", "请问这是什么风格？太喜欢了💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "现代",
              },
              {
                field: "videoDesc",
                keyword: "简约",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "home_decoration_001_2",
            name: "其他风格",
            type: "manual",
            comments: [ "施工周期大概多久？有什么注意事项吗？", "设计师太专业了👍能分享联系方式吗？", "这个风格太有特色了！喜欢😍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "北欧",
              },
              {
                field: "videoDesc",
                keyword: "中式",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "装修",
          },
          {
            field: "videoDesc",
            keyword: "设计",
          },
          {
            field: "videoTag",
            keyword: "装修",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "home_products_002",
        name: "家居好物",
        type: "manual",
        comments: [],
        children: [
          {
            id: "home_products_002_1",
            name: "收纳整理",
            type: "manual",
            comments: [ "这个太实用了！🛋️请问哪里买的？", "质量怎么样？耐用吗？", "收纳效果太好了！小户型必备💡" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "收纳",
              },
              {
                field: "videoDesc",
                keyword: "整理",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "home_products_002_2",
            name: "家具家电",
            type: "manual",
            comments: [ "种草了！这个价格很划算👍", "我也买了！确实很好用✨", "性价比不错！准备入手💕" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "家具",
              },
              {
                field: "videoDesc",
                keyword: "家电",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "好物",
          },
          {
            field: "videoDesc",
            keyword: "收纳",
          },
          {
            field: "videoTag",
            keyword: "家居",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
  {
    id: "10",
    name: "10-数码科技",
    groups: [
      {
        id: "tech_review_001",
        name: "数码评测",
        type: "manual",
        comments: [],
        children: [
          {
            id: "tech_review_001_1",
            name: "手机平板",
            type: "manual",
            comments: [ "评测很专业！📱正在纠结要不要买", "请问续航实际表现怎么样？", "这个价位性价比确实高👍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "手机",
              },
              {
                field: "videoDesc",
                keyword: "平板",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "tech_review_001_2",
            name: "电脑配件",
            type: "manual",
            comments: [ "和上一代比进步大吗？值得升级吗？", "收藏了！准备618入手✨", "性能提升明显吗？玩游戏流畅吗？" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "电脑",
              },
              {
                field: "videoDesc",
                keyword: "显卡",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "评测",
          },
          {
            field: "videoDesc",
            keyword: "开箱",
          },
          {
            field: "videoTag",
            keyword: "数码",
          },
        ],
        aiPrompt: "",
      },
      {
        id: "tech_tips_002",
        name: "科技资讯",
        type: "manual",
        comments: [],
        children: [
          {
            id: "tech_tips_002_1",
            name: "使用技巧",
            type: "manual",
            comments: [ "学到了！这个功能我都不知道💡", "太实用了！马上去试试👍", "讲解很清楚！新手也能看懂" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "技巧",
              },
              {
                field: "videoDesc",
                keyword: "小技巧",
              },
            ],
            aiPrompt: "",
          },
          {
            id: "tech_tips_002_2",
            name: "软件教程",
            type: "manual",
            comments: [ "收藏了！这些技巧太有用了✨", "感谢分享！手机还能这么玩🔥", "这个APP真的好用！已下载👍" ],
            children: [],
            relation: "or",
            rules: [
              {
                field: "videoDesc",
                keyword: "软件",
              },
              {
                field: "videoDesc",
                keyword: "APP",
              },
            ],
            aiPrompt: "",
          },
        ],
        relation: "or",
        rules: [
          {
            field: "videoDesc",
            keyword: "技巧",
          },
          {
            field: "videoDesc",
            keyword: "教程",
          },
          {
            field: "videoTag",
            keyword: "科技",
          },
        ],
        aiPrompt: "",
      },
    ],
  },
] as GrowthCommentTemplate[]

export function templateById(id: string) {
  return GROWTH_COMMENT_TEMPLATES.find(item => item.id === id) || null
}
