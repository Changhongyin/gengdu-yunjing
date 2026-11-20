"""Read the exported design without external dependencies."""
from html.parser import HTMLParser
from html import escape
class Node:
 def __init__(self,tag='',attrs=(),parent=None):self.tag=tag;self.attrs=dict(attrs);self.parent=parent;self.children=[]
 def walk(self):
  yield self
  for c in self.children:
   if isinstance(c,Node):yield from c.walk()
 def text(self):return ''.join(c.text() if isinstance(c,Node) else c for c in self.children).strip()
 def find(self,cls):return next(n for n in self.walk() if cls in n.attrs.get('class','').split())
 def html(self):
  attrs=''.join(' '+k+'="'+escape(v,quote=True)+'"' for k,v in self.attrs.items())
  if self.tag in ('img','image','br','meta','link','input'):return '<'+self.tag+attrs+'/>'
  return '<'+self.tag+attrs+'>'+''.join(c.html() if isinstance(c,Node) else escape(c,quote=False) for c in self.children)+'</'+self.tag+'>'
class Parser(HTMLParser):
 def __init__(self):super().__init__(convert_charrefs=True);self.root=Node('root');self.current=self.root
 def handle_starttag(self,t,a):
  n=Node(t,a,self.current);self.current.children.append(n)
  if t not in ('img','br','meta','link','input','hr'):self.current=n
 def handle_endtag(self,t):
  n=self.current
  while n.parent:
   if n.tag==t:self.current=n.parent;return
   n=n.parent
 def handle_data(self,s):self.current.children.append(s)
def parse(text):
 p=Parser();p.feed(text);return p.root
