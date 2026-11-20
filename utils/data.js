const {asset}=require('./asset-source');
const scenes = [
  { id: 0, postcardImage: '/assets/photos/camphor-canopy.jpg', panoramaImage: '/assets/photos/camphor-canopy.jpg', realPanorama: asset('/assets/panoramas/camphor-enhanced.jpg'), originalPanorama: asset('/assets/panoramas/camphor-original.jpg'), name: '千年古樟', subtitle: '樟下听书', chapter: '壹', postcard: '樟下书声', intro: '千年古樟撑起一片清荫，耕读文化串起村落日常。在樟影、溪声与书声之间，读一段古村时光。', poem: '在一树清荫里，读一页古村。', question: '本次寻樟之旅，以哪一种文化为线索？', answers: ['耕读文化', '海洋文化', '草原文化'], answer: 0 },
  { id: 1, postcardImage: '/assets/photos/water-divider.jpg', panoramaImage: '/assets/photos/water-divider.jpg', name: '乌竹溪古水秤', subtitle: '溪畔识古', chapter: '贰', postcard: '一溪旧时光', intro: '沿着溪声走近古水秤，读乡村生活里的朴素智慧。放慢脚步，看看流水与村落相伴的日常。', poem: '循一溪清响，拾一段旧时光。', question: '这处风景邀请你沿着什么走近古水秤？', answers: ['海浪', '溪声', '车流'], answer: 1 },
  { id: 2, postcardImage: '/assets/photos/chengqi-front.jpg', panoramaImage: '/assets/photos/chengqi-front.jpg', name: '承启堂', subtitle: '耕读传家', chapter: '叁', postcard: '堂前有书声', intro: '从一方堂屋读起，感受耕读传家的文化意蕴。在日常的劳作与读书中，寻找古村代代相传的精神。', poem: '一方堂屋里，书声有回响。', question: '承启堂这一站的主题是什么？', answers: ['乡味寻根', '溪畔识古', '耕读传家'], answer: 2 },
  { id: 3, postcardImage: '/assets/photos/siben-front.jpg', panoramaImage: '/assets/photos/siben-front.jpg', name: '四本堂', subtitle: '乡味寻根', chapter: '终章', postcard: '把乡味带回家', intro: '晴日晒菜，雨日读书。一份博士菜，将古法手作、乡味与村落日常连接起来，让古村的慢时光走进三餐。', poem: '把晴日晒进菜香，把乡愁带回家。', question: '博士菜以什么方式留住乡味？', answers: ['古法晾晒与村民手作', '机械雕刻', '织布刺绣'], answer: 0 }
];
const {products}=require('./products');
module.exports = { scenes, products, productById: id => products.find(p => p.id === id) || products[0] };
