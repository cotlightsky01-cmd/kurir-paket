export interface HoldGroupOption {
  id: string;
  label: string;
  inviteCode: string;
  url: string;
}

export const HOLD_ON_HOLD_GROUP_OPTIONS: HoldGroupOption[] = [
  {
    id: 'group_1',
    label: 'Grup On Hold 1',
    inviteCode: 'Kn1DJ9d1X8gLaZ0XS3q83Z',
    url: 'https://chat.whatsapp.com/Kn1DJ9d1X8gLaZ0XS3q83Z?s=cl&p=a&iam=2',
  },
  {
    id: 'group_2',
    label: 'Grup On Hold 2',
    inviteCode: 'DNELCbJTjWvDQPqfuXh2so',
    url: 'https://chat.whatsapp.com/DNELCbJTjWvDQPqfuXh2so?s=cl&p=a&iam=2',
  },
  {
    id: 'group_3',
    label: 'Grup On Hold 3',
    inviteCode: 'Ebc8ZMdtsbVLSAw48JykNh',
    url: 'https://chat.whatsapp.com/Ebc8ZMdtsbVLSAw48JykNh?s=cl&p=a&iam=2',
  },
  {
    id: 'group_4',
    label: 'Grup On Hold 4',
    inviteCode: 'IfG2RcOJU40J2NBtE5jAwU',
    url: 'https://chat.whatsapp.com/IfG2RcOJU40J2NBtE5jAwU?s=cl&p=a&iam=2',
  },
  {
    id: 'group_5',
    label: 'Grup On Hold 5',
    inviteCode: 'K56Vs9eZkFDAIoNiOwRyfl',
    url: 'https://chat.whatsapp.com/K56Vs9eZkFDAIoNiOwRyfl?s=cl&p=a&iam=2',
  },
];

export function extractWaGroupInviteCode(urlOrCode?: string | null): string {
  if (!urlOrCode || typeof urlOrCode !== 'string') return '';
  const trimmed = urlOrCode.trim();
  const urlMatch = trimmed.match(
    /^https?:\/\/chat\.whatsapp\.com\/([A-Za-z0-9_-]{10,40})(?:[?#].*)?$/i
  );
  if (urlMatch) return urlMatch[1];
  if (/^[A-Za-z0-9_-]{10,40}$/.test(trimmed)) return trimmed;
  return '';
}
