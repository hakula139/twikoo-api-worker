import type { TwikooConfig } from '@/types';

export const stringConfig = (config: TwikooConfig, key: string): string | undefined => {
  const v = config[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
};

export const numberConfig = (config: TwikooConfig, key: string, fallback: number): number => {
  const v = config[key];
  if (typeof v === 'number') {
    return Number.isFinite(v) && v > 0 ? v : fallback;
  }
  if (typeof v === 'string') {
    const parsed = parseInt(v, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
  return fallback;
};

export const boolConfig = (config: TwikooConfig, key: string): boolean => {
  const v = config[key];
  if (typeof v === 'boolean') {
    return v;
  }
  if (typeof v === 'string') {
    return v.length > 0 && v !== 'false';
  }
  return false;
};
