"""Inventory every exported image and text against the native app."""
from pathlib import Path
from collections import defaultdict
import re,csv,struct,json
from design_source import parse
root=Path(__file__).resolve().parent.parent
source=(root/'design-reference.html').read_text();tree=parse(source)
css=next(n for n in tree.walk() if n.tag=='style').text()
routes={'wrap':'登录模板（不属于古村流程）','wrap1':'guide','wrap2':'cards','wrap3':'shop','wrap4':'product 自提','wrap5':'product 快递','wrap6':'checkout','wrap7':'village','wrap8':'profile','wrap9':'panorama','wrap10':'postcard'}
def wrap(n):
 while n:
  for c in n.attrs.get('class','').split():
   if c in routes:return c
  n=n.parent
 return ''
def loc(n):return ' > '.join(reversed([a.attrs.get('class',a.tag) for a in ancestors(n) if a.tag not in ('html','body','root')]))
def ancestors(n):
 while n:yield n;n=n.parent
refs=defaultdict(list)
for n in tree.walk():
 imgs=re.findall(r'image_\d+\.png',n.attrs.get('src',''))
 for cls in n.attrs.get('class','').split():
  m=re.search(r'\.'+re.escape(cls)+r' \{([^}]*)\}',css)
  if m:imgs+=re.findall(r'image_\d+\.png',m[1])
 for im in imgs:refs[im].append((routes.get(wrap(n),''),loc(n)))
used=defaultdict(list)
for p in [*root.glob('pages/**/*.*'),*root.glob('components/**/*.*'),*root.glob('utils/*.js'),root/'app.json']:
 if p.suffix not in ('.js','.wxml','.wxss','.json'):continue
 for i,line in enumerate(p.read_text().splitlines(),1):
  for name in set(re.findall(r'image_\d+\.png',line)):used[name].append(f'{p.relative_to(root)}:{i}')
art=(root/'components/scene-art/index.wxml').read_text()
kinds=defaultdict(list)
for kind,body in re.findall(r'kind === \'([^\']+)\'\}\}" class="art-content">(.*?)(?=<view wx:if|$)',art,re.S):
 for name in set(re.findall(r'image_\d+\.png',body)):kinds[name].append(kind)
files=sorted((root/'assets').glob('*.png'),key=lambda p:int(p.stem.split('_')[1]))
with (root/'docs/图片逐项对照.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.writer(f);w.writerow(['素材','宽','高','原设计页面','原设计层级（精确位置）','当前代码引用','组件用途','静态核对结论'])
 for p in files:
  width,height=struct.unpack('>II',p.read_bytes()[16:24]);r=refs[p.name]
  w.writerow([p.name,width,height,' / '.join(dict.fromkeys(x[0] for x in r)),' / '.join(x[1] for x in r),' / '.join(used[p.name]),' / '.join(kinds[p.name]),'已引用（显示仍受页面状态与裁切影响）' if used[p.name] else '未直接引用；见页级说明，不能等同于缺图'])
def norm(s):return re.sub(r'\s+','',s).replace('·','').replace('／','/')
runtime={str(p.relative_to(root)):norm(p.read_text()) for p in [*root.glob('pages/**/*.*'),*root.glob('components/**/*.wxml'),*root.glob('utils/*.js'),root/'app.json'] if p.suffix in ('.wxml','.js','.json')}
texts=[]
for n in tree.walk():
 cs=n.attrs.get('class','').split()
 if not any(re.fullmatch('text[0-9]*',c) for c in cs):continue
 value=' '.join(n.text().split())
 if not value:continue
 hits=[p for p,s in runtime.items() if norm(value) in s]
 route=routes.get(wrap(n),'');cls=n.attrs.get('class','')
 detail='存在原文引用' if hits else '由页面模板与 utils/data.js / utils/store.js 动态组合，见页级核对说明'
 if not hits:
  if route.startswith('登录'):detail='原导出文件附带的英文登录模板；当前小程序未使用'
  elif value=='9:41':detail='由微信系统状态栏提供实际时间，不应绘制固定时间'
  elif cls=='text58':detail='未接入线下兑换；当前卡集仅显示集齐成就，不宣称可兑换'
  elif cls in ('text72','text81','text97','text124'):detail='未使用：设计的 1/2 轮播计数；当前每个商品只有一幅可用完整主图'
  elif cls in ('text70','text91','text171'):detail='演示流程文案调整：在线购买/去付款改为查看购物车/生成演示订单'
  elif cls in ('text165','text167','text170'):detail='原稿自提却显示运费8元、合计36元；当前按自提0元/快递6元动态计算'
  elif cls in ('text174','text182','text184'):detail='当前未实现村落搜索/外部导航；原稿没有目的地经纬度'
  elif cls in ('text191','text198','text205','text212'):detail='当前未实现打卡留言入口和存储；原稿仅有入口标签'
  elif cls=='text243':detail='语义差异：原稿我的收藏指村落/景点；当前 favorites 指商品收藏'
  elif cls in ('text245','text246','text248'):detail='入口合并/更名：当前为购买记录、商品收藏、我的购物车，见 profile 页面'
  elif cls in ('text219','text220','text223','text224','text216'):detail='已合并展示为“竞赛示例 · 活动时间待发布”；没有正式活动时间'
  elif cls in ('text225','text226'):detail='部分使用：保留开放交通提示；原稿的资料说明标题与来源句未完整显示'
  elif cls in ('text189','text210'):detail='以 utils/data.js 中同一景点的扩写介绍替代原稿短介绍'
  elif cls in ('text103','text130','text116','text168','text236','text272','text256'):detail='同主题文案改写/缩略；详见页级核对说明'
 texts.append([route,cls,value,' / '.join(hits),detail])
with (root/'docs/文字逐项对照.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.writer(f);w.writerow(['原设计页面','文字层级','原文','当前代码原文位置','文本核对']);w.writerows(texts)
print(json.dumps({'images':len(files),'referenced_images':sum(bool(used[p.name]) for p in files),'unreferenced_images':sum(not used[p.name] for p in files),'text_items':len(texts),'text_exact_matches':sum(bool(x[3]) for x in texts)},ensure_ascii=False))
