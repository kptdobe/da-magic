import React, { useState } from 'react';

interface EditModalProps {
  title: string;
  initialContent: string;
  onSave: (content: string) => Promise<void>;
  onClose: () => void;
}

const EditModal: React.FC<EditModalProps> = ({ title, initialContent, onSave, onClose }) => {
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(content);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setSaving(false);
    }
  };

  return (
    <div className="edit-modal-overlay" onClick={onClose}>
      <div className="edit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="edit-modal-header">
          <span className="edit-modal-title">{title}</span>
          <button className="edit-modal-close" onClick={onClose} disabled={saving}>✕</button>
        </div>
        <textarea
          className="edit-modal-textarea"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          autoFocus
        />
        {error && <div className="edit-modal-error">{error}</div>}
        <div className="edit-modal-footer">
          <button className="edit-modal-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="edit-modal-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default EditModal;
