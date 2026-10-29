export function demoEnvironment(input: NodeJS.ProcessEnv, root?: string): {database: string; origin: string; instance: string; owner: string; env: NodeJS.ProcessEnv};
export function demoTarget(input: NodeJS.ProcessEnv): ReturnType<typeof demoEnvironment>;
export function inspectDemo(plan: {origin: string; instance: string}): Promise<string>;
export function ensureDemoDatabase(plan: ReturnType<typeof demoEnvironment>, connect: (url: string) => import('pg').Client): Promise<void>;
