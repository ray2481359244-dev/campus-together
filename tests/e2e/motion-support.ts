import type {Page} from '@playwright/test';
export async function recordFeedback(page:Page){
  await page.evaluate(()=>{
    const rows:{id:string;kind:string;animations:number}[]=[];(window as unknown as Record<string,unknown>).motionFeedback=rows;
    new MutationObserver(records=>{for(const record of records){const node=record.target as HTMLElement;
      if(record.attributeName==='data-cloud-arriving'&&node.dataset.cloudArriving==='true')rows.push({id:node.dataset.cloudId!,kind:node.className,animations:node.getAnimations().length});
      if(record.attributeName==='data-bell-pulse')rows.push({id:'bell:'+node.dataset.bellPulse,kind:node.className,animations:node.getAnimations({subtree:true}).length});
    }}).observe(document.body,{subtree:true,attributes:true,attributeFilter:['data-cloud-arriving','data-bell-pulse']});
  });
}
export async function feedback(page:Page){return page.evaluate(()=>(window as unknown as {motionFeedback:{id:string;kind:string;animations:number}[]}).motionFeedback);}
