import xss from 'xss';

export const sanitizeHtml = (input: string): string => xss(input);
