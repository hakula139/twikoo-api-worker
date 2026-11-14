export const IMAGE_PHOTOS = [
  {
    mimeType: 'image/png',
    photo:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQAAAAA3bvkkAAAACklEQVQI12NoAAAAggCB3UNq9AAAAABJRU5ErkJggg==',
  },
  {
    mimeType: 'image/jpeg',
    photo:
      'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDACgcHiMeGSgjISMtKygwPGRBPDc3PHtYXUlkkYCZlo+AjIqgtObDoKrarYqMyP/L2u71////m8H////6/+b9//j/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAABf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AZf/Z',
  },
  {
    mimeType: 'image/gif',
    photo: 'data:image/gif;base64,R0lGODlhAQABAPAAAP///wAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==',
  },
  {
    mimeType: 'image/webp',
    photo: 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAgA0JaQAA3AA/vuUAAA=',
  },
] as const;

export const PNG_PHOTO = IMAGE_PHOTOS[0].photo;
export const PNG_BYTES = Uint8Array.from(atob(PNG_PHOTO.split(',')[1]), (char) =>
  char.charCodeAt(0),
);
