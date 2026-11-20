/* MCGateway number reels: adapted from the digit-track behavior on the live site.
   Values always come from the latest validated snapshot, never invented increments. */
(() => {
  'use strict';
  const states = new WeakMap();
  const format = n => new Intl.NumberFormat('en-US').format(n);
  const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const numeric = value => {
    if(typeof value==='number')return Number.isSafeInteger(value) && value>=0 ? value : null;
    if(typeof value!=='string'|| !/^[0-9][0-9,]*$/.test(value))return null;
    const n=Number(value.replace(/,/g,''));
    return Number.isSafeInteger(n)&&n>=0 ? n:null;
  };
  function cell(text, className) {
    const span=document.createElement('span');
    span.className=className;
    span.textContent=text;
    span.setAttribute('aria-hidden','true');
    return span;
  }
  function reel(oldDigit,targetDigit,initial,placeFromRight){
    const oldN=Number(oldDigit), newN=Number(targetDigit);
    let steps=(newN-oldN+10)%10;
    const changed=steps!==0;
    const spin=initial||changed||placeFromRight<2;
    if(!spin)return {element:cell(targetDigit,'rolling-digit static'),duration:0};
    if(steps===0)steps=10;
    if(initial && placeFromRight<2)steps+=10;
    const slot=cell('','rolling-digit slot');
    const track=cell('','digit-track');
    for(let i=0;i<=steps;i++)track.append(cell(String((oldN+i)%10),'digit-cell'));
    slot.append(track);
    const duration=Math.min(initial?3100:2100,(initial?1150:620)+steps*(initial?75:70)+placeFromRight*28);
    if(steps>=7){slot.classList.add('blur-spin');slot.style.animationDuration=duration+'ms';}
    return {element:slot,track,steps,duration};
  }
  function show(element,value){
    let state=states.get(element);
    if(!state){state={displayed:null,target:null,animating:false,timer:null};states.set(element,state);}
    state.target=value;
    if(state.animating)return;
    animate(element,state);
  }
  function animate(element,state){
    if(state.animating||state.target===null||state.target===state.displayed)return;
    const value=state.target,first=state.displayed===null;
    const from=first?0:state.displayed;
    if(reduceMotion()){
      element.textContent=format(value);element.setAttribute('aria-label',format(value));
      state.displayed=value;state.animating=false;return;
    }
    const toDigits=String(value),oldDigits=String(from).padStart(toDigits.length,'0');
    const changed=value!==from;
    const parts=[],fragment=document.createDocumentFragment();
    let index=0,maxDuration=0;
    for(const char of format(value)){
      if(char===','){fragment.append(cell(',','rolling-separator'));continue;}
      const pos=toDigits.length-index-1;
      if(!first && !changed){
        fragment.append(cell(char,'rolling-digit static'));
      }else if(!first && oldDigits[index]===char && pos>=2){
        fragment.append(cell(char,'rolling-digit static'));
      }else{
        const part=reel(oldDigits[index]||'0',char,first,pos);
        fragment.append(part.element);
        if(part.track)parts.push(part);
        maxDuration=Math.max(maxDuration,part.duration);
      }
      index++;
    }
    element.classList.add('mcg-rolling-number');
    element.classList.remove('mcg-number-updated');
    element.replaceChildren(fragment);
    element.setAttribute('aria-label',format(value));
    if(!first){void element.offsetWidth;element.classList.add('mcg-number-updated');}
    state.displayed=value;
    if(maxDuration===0){state.animating=false;return;}
    state.animating=true;
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      for(const part of parts){
        part.track.style.transitionDuration=part.duration+'ms';
        part.track.style.transform='translateY(-'+part.steps+'em)';
      }
    }));
    state.timer=setTimeout(()=>{
      state.animating=false;state.timer=null;
      // Settle the reels to actual text before accepting the next update.
      element.textContent=format(value);
      element.classList.remove('mcg-number-updated');
      if(state.target!==state.displayed)animate(element,state);
    },maxDuration+90);
  }
  function clear(element,value){
    const state=states.get(element);
    if(state?.timer)clearTimeout(state.timer);
    states.delete(element);
    element.classList.remove('mcg-rolling-number','mcg-number-updated');
    element.removeAttribute('aria-label');
    element.textContent=String(value);
  }
  window.MCGatewayRoll=Object.freeze({set:show,clear});
})();
