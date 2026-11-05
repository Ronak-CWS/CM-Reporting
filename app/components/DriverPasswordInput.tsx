'use client';

import { useState } from 'react';
import AppIcon from './AppIcon';

export default function DriverPasswordInput() {
  const [visible, setVisible] = useState(false);
  const toggleLabel = visible ? 'Hide password' : 'Show password';

  return <div className="driver-password-field">
    <input id="driver-password" name="password" type={visible ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" spellCheck={false} required maxLength={128} />
    <button className="driver-password-toggle" type="button" aria-label={toggleLabel} title={toggleLabel} aria-controls="driver-password" aria-pressed={visible} onClick={() => setVisible(!visible)}>
      <AppIcon name={visible ? 'eye-off' : 'eye'} />
    </button>
  </div>;
}
