export const stripCode = <T extends { code: number }>(result: T): Omit<T, 'code'> => {
  const { code: _code, ...rest } = result;

  return rest;
};
