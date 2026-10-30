import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './lib/auth';
import {SchoolProvider} from './lib/school';
import {VisualPreferencesProvider} from './lib/visual-preferences';
import { App } from './App';
import './styles.css';
import './cloud-ui.css';
import './platform-ui.css';
import './workbench-ui.css';
import './message-motion.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: true }, mutations: { retry: 0 } } });
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><VisualPreferencesProvider><AuthProvider><SchoolProvider><App /></SchoolProvider></AuthProvider></VisualPreferencesProvider></BrowserRouter></QueryClientProvider></React.StrictMode>);
