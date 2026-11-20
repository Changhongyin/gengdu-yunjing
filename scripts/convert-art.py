"""Convert only the visible design artwork, excluding off-canvas export layers."""
from pathlib import Path
import re
from design_source import parse,Node
s=parse(Path('design-reference.html').read_text());css=next(n for n in s.walk() if n.tag=='style').text()
sources={'map':('content8',335,420),'scene0':('subBlock3',144,109),'scene1':('subBlock4',144,109),'scene2':('div1',144,109),'scene3':('subBlock7',144,109),'vegetable':('main48',327,192),'notebook':('section27',327,96),'villageHero':('subSection63',327,189)}
rules=re.findall(r'([^{}]+)\{([^{}]*)\}',css);classes=set();fragments=[]
for kind,(cls,w,h) in sources.items():
 tree=s.find(cls)
 for n in list(tree.walk()):
  if set(n.attrs.get('class','').split()) & {'div19','div16'} and n.parent:n.parent.children.remove(n)
 if kind=='map':
  for i,(c,t) in enumerate([('block4','text18'),('block5','text20'),('block6','text22'),('block7','text24')]):
   el=tree.find(c);el.attrs.update({'bindtap':'pick','data-id':str(i),'hover-class':'landmark-hover'})
   tree.find(t).children=['{{collected['+str(i)+'] ? "✓ 已收藏" : '+('finalUnlocked ? "终章 · 可探索" : "终章 · 待解锁"' if i==3 else '"'+['壹','贰','叁'][i]+' · 可探索"')+'}}']
  tree.find('image11').attrs['wx:if']='{{collected[0]}}'
 for n in list(tree.walk()):
  cs=n.attrs.get('class','').split();classes.update(cs)
  for c in cs:
   m=re.search(r'\.'+re.escape(c)+r' \{([^}]*)\}',css)
   bg=re.search(r"background-image:url\(['\"]?([^'\")]+)",m[1]) if m else None
   if bg:
    im=Node('image',{'class':'art-bg','src':bg[1].replace('./assets/','/assets/'),'mode':'scaleToFill'}.items(),n);n.children.insert(0,im)
  if n.tag=='div':n.tag='view'
  elif n.tag=='img':n.tag='image';n.attrs['mode']='scaleToFill';n.attrs['src']=n.attrs['src'].replace('./assets/','/assets/')
 tree.attrs['class']=tree.attrs.get('class','')+' art-root'
 markup=tree.html().replace('src="/assets/image_15.png"','src="{{assetImages.image15}}"').replace('src="/assets/image_30.png"','src="{{assetImages.image30}}"')
 fragments.append('<view wx:if="{{kind === \''+kind+'\'}}" class="art-content">'+markup+'</view>')
used=[]
for sel,body in rules:
 if classes.intersection(re.findall(r'\.([\w]+)',sel)):
  hasbg='background-image:' in body;body=re.sub(r'background-image:[^;]+;','',body)
  if hasbg and 'position:' not in body:body+='position:relative;'
  used.append(sel+'{'+body+'}')
Path('components/scene-art/index.wxss').write_text('\n'.join(used)+'\n.art-fit{width:100%;position:relative;overflow:hidden;}.art-native{position:absolute;left:0;top:0;transform-origin:left top;}.art-bg{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;}.art-content > .art-root{margin:0!important;position:relative!important;top:0!important;left:0!important;}.landmark-hover{opacity:.65;}')
Path('components/scene-art/index.wxml').write_text('<view class="art-fit" style="height:{{boxHeight}}px"><view class="art-native" style="width:{{naturalWidth}}px;height:{{naturalHeight}}px;transform:scale({{scale}})">'+''.join(fragments)+'</view></view>')
print('Converted',len(sources),'artworks with',len(used),'style rules')
