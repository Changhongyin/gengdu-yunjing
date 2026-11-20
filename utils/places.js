// Facts paraphrased from the user supplied 古渊头村AI讲解知识库.docx.
// Literary headings and observation prompts are original AI editorial copy.
const photos={
  "camphor-trunk": "/assets/photos/camphor-trunk.jpg",
  "camphor-square": "/assets/photos/camphor-square.jpg",
  "chengqi-interior": "/assets/photos/chengqi-interior.jpg",
  "chengqi-front": "/assets/photos/chengqi-front.jpg",
  "camphor-canopy": "/assets/photos/camphor-canopy.jpg",
  "village-lane": "/assets/photos/village-lane.jpg",
  "chengqi-gate": "/assets/photos/chengqi-gate.jpg",
  "siben-detail": "/assets/photos/siben-detail.jpg",
  "siben-angle": "/assets/photos/siben-angle.jpg",
  "water-divider": "/assets/photos/water-divider.jpg",
  "siben-front": "/assets/photos/siben-front.jpg",
  "water-channel": "/assets/photos/water-channel.jpg",
  "water-street": "/assets/photos/water-street.jpg"
};
const photo=(file,caption)=>({src:photos[file],caption});
const places=[
 {id:0,name:'千年古樟',en:'THE CAMPHOR TREE',kicker:'壹 · 樟下听书',line:'一树清荫，\n与一村人相守。',summary:'从村北口的古樟开始，读人与树长久相伴的故事。',tags:['古树地标','生活记忆','生态守护'],gallery:[photo('camphor-canopy','古樟全貌 · 树冠与支撑'),photo('camphor-trunk','近看枝干 · 古树的纹理'),photo('camphor-square','树下空间 · 古樟与村落')],facts:[['所在','村北口'],['主题','古树保护'],['看点','树冠与支撑']],sections:[{title:'一棵树，也是村庄的记忆',text:'村北口古樟是古渊头的重要自然地标。浙江日报记录过村民“樟树爹”“樟树娘”的亲切称呼。这些生活里的名字，表达了人与古树长期相伴的感情。'},{title:'把清荫留给后来的人',text:'2021年的保护报道记录了疏理树干周边土壤、支撑大侧枝和日常巡查等措施。古树的长久生长，依赖枝干、根系与周边环境共同得到照顾。精确树龄以最新挂牌档案为准。'}],observation:'抬头找一找：哪些大枝条有支撑？再退后几步，看看树冠怎样为村口撑起一片清荫。',sources:'知识库第六节；S02 浙江日报（2016）、S05 最高人民检察院网站（2021）。',note:'从保护区域外观赏，不攀折枝条、不踩踏根区。'},
 {id:1,name:'乌竹溪古水秤',en:'WATER & COMMON GROUND',kicker:'贰 · 溪畔识古',line:'一渠流水，\n分出相处的智慧。',summary:'循着古甽的水声，认识分水石与共同用水的规则。',tags:['古甽水系','分水智慧','街巷日常'],gallery:[photo('water-divider','分水设施 · 观察水流分向'),photo('water-street','沿渠街巷 · 水与日常'),photo('water-channel','石渠近景 · 老墙与流水')],facts:[['所在','村内古甽'],['主题','分水规则'],['看点','水流与石渠']],sections:[{title:'水秤，原来是分水的石头',text:'知识库所引“问水古渊头”报道中，水秤指渠道里的分水石。它与用户、田亩的用水需要及共同认可的分配约定有关，展现的是如何让一股水服务不同需要的智慧。'},{title:'水流穿过村庄的日常',text:'当地把水渠称为“甽”。水经过明渠、暗渠，与街巷和庭院联系在一起，历史上承担洗涤、灌溉、防火等用途。沿水而行，可以观察水从哪里来、在哪儿转弯、又流向哪里。'}],observation:'站在岸上看一会儿：石块两侧的水怎样流动？如果两条支路需要的水量不同，你会怎样分配？',sources:'知识库第五节及古甽讲解稿；S03 歌画东阳《问水古渊头 九曲绕村岁月悠》（2023）。',note:'照片为调研中的古甽及分水设施；从岸上观察，不移动石块、不堵塞水渠。'},
 {id:2,name:'承启堂',en:'A HALL OF INHERITANCE',kicker:'叁 · 耕读传家',line:'一方堂屋，\n听见家风的回响。',summary:'从门墙走进厅堂，在砖木之间细读古村的家风。',tags:['古建厅堂','题额与家风','砖木细节'],gallery:[photo('chengqi-front','承启堂 · 门墙与入口'),photo('chengqi-interior','承启堂 · 厅堂梁架'),photo('chengqi-gate','承启堂 · 内外相接的门廊')],facts:[['所在','古村街巷'],['主题','古建家风'],['看点','门墙与梁架']],sections:[{title:'先读门额，再读一座堂',text:'调研照片中的现场说明牌标明“承启堂”，又名“四份厅”，初建于清道光年间，并介绍了五级马头墙、砖雕及“承启堂”题额等线索。此处年代与建筑名称依照现场标牌整理。'},{title:'在砖与木之间，慢下来',text:'门楼、厅堂、庭院与街巷共同构成古村的生活空间。参观时可以先看整体比例，再观察屋脊、梁架与装饰细节。从一处题字或一扇门开始，理解家风怎样被安放在日常生活里。'}],observation:'从门外到堂内，光线怎样变化？挑一个木构细节，记录你看到的形状，不急着给它命名。',sources:'调研原片 DJI_20261114133958_0342_D.JPG（承启堂现场说明牌）；知识库第四节古建筑与村落空间。',note:'开放范围以现场安排为准，进入厅堂请保持安静。'},
 {id:3,name:'四本堂',en:'LEARNING THROUGH GENERATIONS',kicker:'终章 · 乡味寻根',line:'一座老堂，\n续写耕读的文脉。',summary:'读一处门额，追寻村庄办学、养贤与重教的传统。',tags:['四本义塾','耕读文脉','古宅门楼'],gallery:[photo('siben-front','四本堂 · 现场标牌可辨的门楼'),photo('siben-angle','四本堂 · 门楼侧景'),photo('siben-detail','四本堂 · 门额与砖雕')],facts:[['所在','古村街巷'],['主题','重教传统'],['看点','门额与砖雕']],sections:[{title:'让读书成为一村人的事',text:'知识库所引报道把四本堂、一经堂与四本义塾联系起来，记述了办义塾、延请教师、资助子弟求学等线索。古村的教育故事，由建筑、办学与家庭支持共同串起。'},{title:'从一处门楼，走近一段文脉',text:'调研原片里，门旁的“四本堂”说明牌与门楼同框。欣赏时可以先读门额，再看砖雕的层次与门庭的空间。建筑的确切沿革、现状展陈和开放范围，仍以村方正式资料为准。'}],observation:'读一读门额上的字。若为今天的孩子留一句家训，你最想留下什么？',sources:'知识库第二、四节；S04 歌画东阳《问水古渊头 一渠水脉滋文脉》（2023）；四本堂现场标牌原片。',note:'走近门楼，细读一处题额；开放范围以现场安排为准。'}
];
const village={id:'village',name:'古渊头村',en:'GU YUAN TOU · VILLAGE ARCHIVE',kicker:'村落档案 · 东阳巍山',line:'一村，一树，\n一卷书。',summary:'在樟影、溪声与书声之间，读一段古村时光。',tags:['传统村落','古甽水系','耕读传家'],gallery:[photo('camphor-canopy','古樟清荫 · 村落的自然地标'),photo('village-lane','沿水入巷 · 古村日常'),photo('siben-front','四本堂门楼 · 耕读文脉')],facts:[['所在','东阳 · 巍山'],['村落','600余年¹'],['名录','传统村落²']],sections:[{title:'因水而名，在水边生活',text:'古渊头村位于浙江省东阳市巍山镇。公开报道将村名与古代引水工程联系起来，并列出“古堰头”“古堰里”等旧称。明渠、暗渠穿过街巷与庭院，水也成为认识古村生活的一条线索。'},{title:'耕读传家，写在日常里',text:'村庄有办学与养贤的传统。家庭支持孩子外出求学，学成的人又回馈家乡。古宅、义塾与普通家常菜，都能帮助我们理解这里的重教家风。所谓“博士菜”，也是梅干菜与求学生活相联系的饮食记忆。'},{title:'老村落，继续生长',text:'古樟、古甽、古民居与古墩墓，是公开报道概括的“四古”线索。2019年，古渊头村进入第五批中国传统村落名单；2023年入选浙江省第三批未来乡村创建名单。保护与生活，在这里延续着新的往来。'}],observation:'从树、水、屋里选一个喜欢的主题，带着一个问题走进村庄。你会先停在哪一处？',sources:'用户提供《古渊头村AI讲解知识库》第一、二、九节。¹ 2016年浙江日报报道口径；² 2019年第五批中国传统村落名录。',note:'交通、停车与建筑开放安排以村方正式公告为准。'};
module.exports={places,village,getPlace:id=>id==='village'?village:places[Number(id)]||places[0]};
