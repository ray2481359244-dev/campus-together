export function productionChecks(env) {
  const checks=[];const add=(code,pass,message)=>checks.push({code,pass:!!pass,message});
  add('MODE',env.NODE_ENV==='production'&&env.APP_MODE==='STANDARD','使用 production / STANDARD，正式环境不导入公开演示账号。');
  let originOK=false,dbOK=false;
  try{const origin=new URL(env.SERVE_ORIGIN);originOK=origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.pathname==='/'&&!origin.search&&!origin.hash&&!/(localhost|127\.0\.0\.1|\.invalid|\.example|example\.com)$/i.test(origin.hostname)&&env.SERVE_ORIGIN===origin.origin;}catch{}
  add('ORIGIN',originOK,'SERVE_ORIGIN 必须是本次部署实际使用的 HTTPS 域名源，不能有路径或示例域名。');
  try{const url=new URL(env.DATABASE_URL);dbOK=['postgres:','postgresql:'].includes(url.protocol)&&url.username&&url.password&&decodeURIComponent(url.password).length>=16&&!/REPLACE|CHANGE|EXAMPLE/i.test(env.DATABASE_URL)&&!/(?:_test|_restore)$/.test(url.pathname);}catch{}
  add('DATABASE',dbOK,'生产数据库须独立配置有效凭据，不能使用测试 / 恢复库或模板密码。');
  add('CSRF',(env.CSRF_SECRET||'').length>=32&&!/REPLACE|CHANGE|EXAMPLE/i.test(env.CSRF_SECRET||''),'CSRF_SECRET 至少 32 字符，部署时独立生成。');
  add('AI',(env.AI_MODE||'RULES_ONLY')==='RULES_ONLY','本轮按用户决定保持 RULES_ONLY，不需要模型地址或密钥。');
  add('LISTEN',(env.HOST||'127.0.0.1')==='127.0.0.1','应用仅监听 127.0.0.1，由同机 HTTPS 代理转发。');
  add('PROXY',env.TRUST_PROXY==='loopback','仅信任同机反向代理，正确使用真实访问 IP 限流。');
  add('PORT',/^\d+$/.test(env.PORT||'3001')&&Number(env.PORT||3001)>=1024&&Number(env.PORT||3001)<=65535,'配置有效的应用内部端口。');
  const retention=Number(env.CHAT_ARCHIVE_SECONDS||2592000);add('ARCHIVE',Number.isInteger(retention)&&retention>=86400&&retention<=31536000,'生产归档期限须为一天至一年。');
  return checks;
}
