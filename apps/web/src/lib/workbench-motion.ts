import { createContext } from 'react';

export const WorkbenchMotionContext = createContext<null | ((target: string) => void)>(null);
