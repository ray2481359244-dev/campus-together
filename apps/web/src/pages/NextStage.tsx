import { Link } from 'react-router-dom';
import { ArrowUpRight, Users, MessageSquare } from 'lucide-react';
import { PageTitle } from '../components/UI';
export function NextStage({ kind }: { kind: 'recruitments' | 'messages' }) {
  const recruit = kind === 'recruitments', Icon = recruit ? Users : MessageSquare;
  return <section className="next-stage"><PageTitle title={recruit ? '把喜欢，变成一起行动。' : '协作的消息，会在这里汇合。'} eyebrow={recruit ? 'NEXT UP / TEAM BUILDING' : 'NEXT UP / TEAM CONVERSATIONS'} /><div className="paper stage-notice"><span className="stage-symbol"><Icon size={38} /></span><h2>{recruit ? '招募模块正在下一阶段推进' : '群聊与通知尚未开放'}</h2><p>{recruit ? '接下来将实现真实招募、岗位名额、条件对照、申请审核与成员加入。当前可以先发布讨论，交流想法。' : '完成组队与成员权限后，再开放真实多人文字群聊与持久化通知。当前没有模拟消息。'}</p><Link className="button" to={recruit ? '/publish' : '/discover'}>{recruit ? '先聊聊你的想法' : '回到校园讨论'}<ArrowUpRight size={19} /></Link></div></section>;
}
