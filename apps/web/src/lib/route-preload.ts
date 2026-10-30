const loaders:Record<string,()=>Promise<unknown>>={
  '/recruitments':()=>import('../pages/Recruitments'),'/publish':()=>import('../pages/Publish'),
  '/messages':()=>import('../pages/Notifications'),'/me':()=>import('../pages/Profile'),
  '/teams':()=>import('../pages/MyTeams'),'/saved':()=>import('../pages/Saved'),
  '/posts/detail':()=>import('../pages/PostDetail'),'/recruitments/detail':()=>import('../pages/RecruitmentDetail'),'/recruitments/new':()=>import('../pages/RecruitmentEditor'),'/teams/detail':()=>import('../pages/TeamDetail'),'/teams/chat':()=>import('../pages/TeamChat'),'/topic-requests':()=>import('../pages/TopicRequests'),'/admin':()=>import('../pages/Admin'),
  '/matching':()=>import('../pages/Matching'),'/login':()=>import('../pages/Auth'),'/register':()=>import('../pages/Auth'),
};
const pending=new Map<string,Promise<unknown>>();
export function preloadRoute(path:string){if(/^\/posts\/[^/]+\/edit$/.test(path))path='/publish';else if(/^\/posts\/[^/]+$/.test(path))path='/posts/detail';else if(/^\/recruitments\/[^/]+\/edit$/.test(path))path='/recruitments/new';else if(/^\/recruitments\/[^/]+$/.test(path)&&path!=='/recruitments/new')path='/recruitments/detail';else if(/^\/teams\/[^/]+\/chat$/.test(path))path='/teams/chat';else if(/^\/teams\/[^/]+$/.test(path))path='/teams/detail';const loader=loaders[path];if(loader&&!pending.has(path)){const request=loader().catch(()=>{pending.delete(path);});pending.set(path,request);}}
