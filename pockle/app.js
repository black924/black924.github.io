(function(){var L=['ko','en','ja'],l='ko';try{var q=new URLSearchParams(location.search).get('lang'),s=localStorage.getItem('hnh-lang'),n=((navigator.languages&&navigator.languages[0])||navigator.language||'').slice(0,2).toLowerCase();
if(q&&L.indexOf(q)>-1)l=q;else if(s&&L.indexOf(s)>-1)l=s;else if(L.indexOf(n)>-1)l=n;else l='en'}catch(e){}
function set(v){l=v;var r=document.documentElement;r.dataset.l=v;r.lang=v;try{localStorage.setItem('hnh-lang',v)}catch(e){}
var t=document.querySelectorAll('title[data-t]');var el=document.getElementById('lang');if(el)el.value=v;var T=document.documentElement.getAttribute('data-title-'+v);if(T)document.title=T}
set(l);document.addEventListener('DOMContentLoaded',function(){var el=document.getElementById('lang');if(el){el.value=l;el.addEventListener('change',function(){set(el.value)})}});
})();
