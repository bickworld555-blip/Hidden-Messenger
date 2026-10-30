import { Platform } from 'react-native';
import * as Contacts from 'expo-contacts/legacy';

export type LocalContactPermission = {
  status: 'unavailable' | 'undetermined' | 'denied' | 'granted' | 'limited';
  canAskAgain: boolean;
};

export type LocalPhoneContact = {
  id: string;
  name: string;
  phoneNumber: string;
};

const unavailable: LocalContactPermission = { status: 'unavailable', canAskAgain: false };

function normalizePermission(response: Awaited<ReturnType<typeof Contacts.getPermissionsAsync>>): LocalContactPermission {
  if (response.granted) {
    return {
      status: response.accessPrivileges === 'limited' ? 'limited' : 'granted',
      canAskAgain: response.canAskAgain,
    };
  }
  return {
    status: response.status === 'denied' ? 'denied' : 'undetermined',
    canAskAgain: response.canAskAgain,
  };
}

export async function getLocalContactPermission(): Promise<LocalContactPermission> {
  if (Platform.OS === 'web') return unavailable;
  if (!(await Contacts.isAvailableAsync())) return unavailable;
  return normalizePermission(await Contacts.getPermissionsAsync());
}

export async function requestLocalContactPermission(): Promise<LocalContactPermission> {
  if (Platform.OS === 'web') return unavailable;
  if (!(await Contacts.isAvailableAsync())) return unavailable;
  return normalizePermission(await Contacts.requestPermissionsAsync());
}

export async function readLocalPhoneContacts(): Promise<LocalPhoneContact[]> {
  if (Platform.OS === 'web') return [];
  const permission = await getLocalContactPermission();
  if (permission.status !== 'granted' && permission.status !== 'limited') {
    throw new Error('Allow contact access before viewing on-device contacts.');
  }

  const response = await Contacts.getContactsAsync({
    fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
  });
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return response.data
    .map((contact) => {
      const name = contact.name?.trim()
        || [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim()
        || 'Unnamed contact';
      const phoneNumber = contact.phoneNumbers?.find((phone) => phone.isPrimary && phone.number)?.number
        ?? contact.phoneNumbers?.find((phone) => phone.number)?.number;
      if (!contact.id || !phoneNumber?.trim()) return null;
      return { id: String(contact.id), name, phoneNumber: phoneNumber.trim() };
    })
    .filter((contact): contact is LocalPhoneContact => contact !== null)
    .sort((left, right) => collator.compare(left.name, right.name));
}
