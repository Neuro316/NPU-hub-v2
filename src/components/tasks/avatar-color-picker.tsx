'use client'

import { useState } from 'react'
import { USER_COLORS, getUserInitials, getUserColor, type ColorOverrides } from '@/lib/user-colors'
import { Palette, X, Check } from 'lucide-react'

interface AvatarColorPickerProps {
  teamMembers: string[]
  colorOverrides: ColorOverrides
  onSave: (overrides: ColorOverrides) => Promise<void>
}

export function AvatarColorPicker({ teamMembers, colorOverrides, onSave }: AvatarColorPickerProps) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [localOverrides, setLocalOverrides] = useState<ColorOverrides>(colorOverrides)
  const [saving, setSaving] = useState(false)

  const handlePick = async (name: string, colorIndex: number) => {
    const updated = { ...localOverrides, [name]: colorIndex }
    setLocalOverrides(updated)
    setEditing(null)
    setSaving(true)
    await onSave(updated)
    setSaving(false)
  }

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); setLocalOverrides(colorOverrides) }}
        className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50 transition-colors"
        title="Avatar colors"
      >
        <Palette className="w-3.5 h-3.5" /> Colors
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/20" onClick={() => setOpen(false)} />
      <div className="relative bg-white rounded-xl shadow-2xl border border-gray-100 w-full max-w-sm mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-np-dark">Avatar Colors</h3>
            <p className="text-[10px] text-gray-400 mt-0.5">Click a name to change their color</p>
          </div>
          <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Members list */}
        <div className="p-4 space-y-2 max-h-80 overflow-y-auto">
          {teamMembers.map(name => {
            const color = getUserColor(name, localOverrides)
            const isEditing = editing === name

            return (
              <div key={name}>
                <button
                  onClick={() => setEditing(isEditing ? null : name)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isEditing ? 'bg-gray-50 ring-1 ring-gray-200' : 'hover:bg-gray-50'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: color.bg }}
                  >
                    <span className="text-[10px] font-bold" style={{ color: color.text }}>
                      {getUserInitials(name)}
                    </span>
                  </div>
                  <span className="text-xs font-medium text-np-dark flex-1 text-left">{name}</span>
                  <span className="text-[9px] text-gray-400">{color.label}</span>
                </button>

                {/* Color palette */}
                {isEditing && (
                  <div className="flex flex-wrap gap-1.5 px-3 pb-2 pt-1 ml-11">
                    {USER_COLORS.map((c, idx) => {
                      const isSelected = color.bg === c.bg
                      return (
                        <button
                          key={idx}
                          onClick={() => handlePick(name, idx)}
                          title={c.label}
                          className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                            isSelected ? 'ring-2 ring-offset-1' : 'hover:scale-110'
                          }`}
                          style={{
                            backgroundColor: c.bg,
                            outlineColor: isSelected ? c.text : undefined,
                          }}
                        >
                          {isSelected && <Check className="w-3 h-3" style={{ color: c.text }} />}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-[9px] text-gray-400">
            {saving ? 'Saving...' : 'Changes save automatically'}
          </span>
          <button
            onClick={() => setOpen(false)}
            className="text-xs font-medium text-np-blue hover:underline"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
