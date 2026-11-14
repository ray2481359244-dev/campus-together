import { z } from 'zod';

export const topicNameLimit = 40;
export const CustomTopicSchema = z.string().trim()
  .max(topicNameLimit, `主题最多 ${topicNameLimit} 个字`)
  .refine(name => !/\p{Cc}/u.test(name), '主题请写在一行内');
