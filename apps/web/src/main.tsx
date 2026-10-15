import React from 'react';
import { createRoot } from 'react-dom/client';

function Foundation() {
  const [status, setStatus] = React.useState('正在验证 API 与数据库……');
  React.useEffect(() => {
    void Promise.all([fetch('/api/v1/ready').then(r => r.json()), fetch('/api/v1/topics').then(r => r.json())])
      .then(([ready, topics]) => setStatus(ready.data?.ready ? `数据库已连接，读取到 ${topics.data.length} 个主题。` : '数据库尚未就绪。'))
      .catch(() => setStatus('连接失败，请检查服务端和数据库。'));
  }, []);
  return <main style={{ fontFamily: 'system-ui', maxWidth: 700, margin: '60px auto', padding: 25, border: '3px solid #20201e', background: '#fff9ef', boxShadow: '7px 7px #20201e' }}><h1>碰个头 / 工程连通验证</h1><p role="status">{status}</p><p>正在建立真实账号与校园讨论。当前不是完整平台。</p></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Foundation /></React.StrictMode>);
