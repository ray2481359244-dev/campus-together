import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { AuthProvider } from './lib/auth';
import { App } from './App';
import './styles.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 20_000, refetchOnWindowFocus: true }, mutations: { retry: 0 } } });
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><BrowserRouter><MotionConfig reducedMotion="user"><AuthProvider><App /></AuthProvider></MotionConfig></BrowserRouter></QueryClientProvider></React.StrictMode>);
