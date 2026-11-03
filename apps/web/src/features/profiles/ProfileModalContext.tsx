import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ProfilePicker } from './ProfilePicker';

type ProfileModalContextValue = {
  openProfileModal: () => void;
  closeProfileModal: () => void;
};

const ProfileModalContext = createContext<ProfileModalContextValue | null>(null);

export function ProfileModalProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openProfileModal = useCallback(() => setOpen(true), []);
  const closeProfileModal = useCallback(() => setOpen(false), []);
  const value = useMemo(
    () => ({ openProfileModal, closeProfileModal }),
    [openProfileModal, closeProfileModal],
  );

  return (
    <ProfileModalContext.Provider value={value}>
      {children}
      {open && <ProfilePicker variant="modal" onClose={closeProfileModal} />}
    </ProfileModalContext.Provider>
  );
}

export function useProfileModal(): ProfileModalContextValue {
  const ctx = useContext(ProfileModalContext);
  if (!ctx) {
    throw new Error('useProfileModal debe usarse dentro de ProfileModalProvider');
  }
  return ctx;
}
