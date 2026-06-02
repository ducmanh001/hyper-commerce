'use client';

import { ReactNode } from 'react';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open:        boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
  title?:      string;
  message:     ReactNode;
  confirmText?: string;
  cancelText?:  string;
  danger?:     boolean;
  loading?:    boolean;
}

export function ConfirmDialog({
  open, onConfirm, onCancel, title = 'Xác nhận', message,
  confirmText = 'Xác nhận', cancelText = 'Huỷ', danger, loading,
}: ConfirmDialogProps) {
  return (
    <Modal open={open} onClose={onCancel} title={title} size="sm">
      <div className="p-5">
        <p className="text-sm text-gray-600">{message}</p>
        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
              danger ? 'bg-red-500 hover:bg-red-600' : 'bg-[#EE4D2D] hover:bg-[#d43e20]'
            }`}
          >
            {loading ? 'Đang xử lý...' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  );
}
