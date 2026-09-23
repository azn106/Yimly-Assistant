import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Circle, CircleMember, UserInfo } from "../types";
import {
  Users,
  Plus,
  Copy,
  Check,
  QrCode,
  X,
  Shield,
  LogOut,
  ArrowUpRight,
  User,
  Loader2,
  AlertTriangle,
  Radio,
  Trash2
} from "lucide-react";

interface CircleSelectorProps {
  user: UserInfo | null;
  circles: Circle[];
  selectedCircle: Circle | null;
  onSelectCircle: (circle: Circle) => void;
  onCreateCircle: (name: string) => Promise<void>;
  onJoinCircle: (code: string) => Promise<void>;
  onLeaveCircle?: (circleId: number) => Promise<void>;
  onDeleteCircle?: (circleId: number) => Promise<void>;
  loading: boolean;
}

export const CircleSelector: React.FC<CircleSelectorProps> = ({
  user,
  circles,
  selectedCircle,
  onSelectCircle,
  onCreateCircle,
  onJoinCircle,
  onLeaveCircle,
  onDeleteCircle,
  loading
}) => {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [managingCircle, setManagingCircle] = useState<Circle | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);

  // Form states
  const [newCircleName, setNewCircleName] = useState("");
  const [joinInviteCode, setJoinInviteCode] = useState("");
  const [copied, setCopied] = useState(false);

  // Async feedback states
  const [actionLoading, setActionLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  // Managed circle members
  const [circleMembers, setCircleMembers] = useState<CircleMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  // Fetch circle members when managing a circle
  useEffect(() => {
    if (!managingCircle) {
      setCircleMembers([]);
      return;
    }

    const fetchMembers = async () => {
      setMembersLoading(true);
      const token = localStorage.getItem("access_token");
      if (!token) {
        setMembersLoading(false);
        return;
      }

      try {
        const res = await fetch(`/api/circles/${managingCircle.id}/members`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setCircleMembers(data);
        } else {
          setCircleMembers([]);
        }
      } catch (err) {
        console.error("Failed to load circle members:", err);
      } finally {
        setMembersLoading(false);
      }
    };

    fetchMembers();
  }, [managingCircle]);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    if (!newCircleName.trim()) return;

    setActionLoading(true);
    try {
      await onCreateCircle(newCircleName.trim());
      setNewCircleName("");
      setShowCreateModal(false);
    } catch (err: any) {
      setFormError(err.message || "Failed to create Circle");
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);
    const code = joinInviteCode.trim().toUpperCase();
    if (!code) {
      setFormError("Please enter an invitation code.");
      return;
    }

    setActionLoading(true);
    try {
      await onJoinCircle(code);
      setFormSuccess("Successfully joined the Family Circle!");
      setJoinInviteCode("");
      setTimeout(() => {
        setShowJoinModal(false);
        setFormSuccess(null);
      }, 1000);
    } catch (err: any) {
      setFormError(err.message || "Invalid invite code or already a member");
    } finally {
      setActionLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!managingCircle || !onLeaveCircle) return;
    setFormError(null);
    setActionLoading(true);

    try {
      await onLeaveCircle(managingCircle.id);
      setShowLeaveConfirm(false);
      setManagingCircle(null);
    } catch (err: any) {
      setFormError(err.message || "Failed to leave circle");
    } finally {
      setActionLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!managingCircle || !onDeleteCircle) return;
    setFormError(null);
    setActionLoading(true);

    try {
      await onDeleteCircle(managingCircle.id);
      setShowDeleteConfirm(false);
      setManagingCircle(null);
    } catch (err: any) {
      setFormError(err.message || "Failed to delete Family Circle");
    } finally {
      setActionLoading(false);
    }
  };

  const qrCodeUrl = managingCircle
    ? `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(managingCircle.invite_code)}`
    : "";

  return (
    <div className="space-y-4">
      {/* 1. EXISTING FAMILY CIRCLES LIST */}
      <div className="space-y-2.5">
        {circles.length === 0 ? (
          <div className="p-5 rounded-2xl bg-slate-50 border border-slate-100 text-center space-y-2">
            <div className="w-10 h-10 mx-auto rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <p className="text-xs font-bold text-slate-700">No Family Circles Joined</p>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
              Create a new circle for your family or enter an invite code to join an existing one.
            </p>
          </div>
        ) : (
          <div className="grid gap-2.5">
            {circles.map((circle) => {
              const isOwner = user ? circle.owner_id === user.id : false;
              const isActive = selectedCircle?.id === circle.id;

              return (
                <div
                  key={circle.id}
                  className={`p-4 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                    isActive
                      ? "bg-indigo-50/40 border-indigo-200/80 shadow-sm"
                      : "bg-slate-50/60 border-slate-100 hover:border-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                        isActive
                          ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
                          : "bg-white text-slate-600 border border-slate-200/60 shadow-xs"
                      }`}
                    >
                      <Users className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-slate-800 truncate">
                          {circle.name}
                        </span>

                        {isOwner ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200/60 inline-flex items-center gap-1">
                            <Shield className="w-2.5 h-2.5" />
                            Owner
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/70 text-slate-600">
                            Member
                          </span>
                        )}

                        {isActive && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200/60 inline-flex items-center gap-1">
                            <Radio className="w-2.5 h-2.5" />
                            Active on Map
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-400 mt-0.5 font-mono">
                        Invite Code: <span className="font-bold text-slate-600">{circle.invite_code}</span>
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                    {!isActive && (
                      <button
                        type="button"
                        onClick={() => onSelectCircle(circle)}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 hover:text-indigo-600 bg-white hover:bg-indigo-50/50 border border-slate-200/70 hover:border-indigo-200 transition cursor-pointer"
                      >
                        Set Active
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setManagingCircle(circle);
                        setFormError(null);
                        setFormSuccess(null);
                      }}
                      className="px-3.5 py-1.5 rounded-xl text-xs font-bold text-indigo-600 bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-100 transition cursor-pointer"
                    >
                      Manage
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 2. ACTION BUTTONS: CREATE & JOIN */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 pt-1">
        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setFormSuccess(null);
            setShowCreateModal(true);
          }}
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99] text-white font-bold text-xs transition shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Create Family Circle</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setFormError(null);
            setFormSuccess(null);
            setShowJoinModal(true);
          }}
          disabled={loading}
          className="flex-1 px-4 py-2.5 rounded-2xl bg-white hover:bg-slate-50 active:scale-[0.99] text-slate-700 font-bold text-xs border border-slate-200 transition shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <ArrowUpRight className="w-4 h-4 text-indigo-600" />
          <span>Join Family Circle</span>
        </button>
      </div>

      {/* 3. MANAGE CIRCLE VIEW (MODAL) */}
      {managingCircle && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto pointer-events-auto">
          <div className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 my-auto max-h-[calc(100dvh-2.5rem)] overflow-y-auto space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-extrabold text-slate-800">
                    {managingCircle.name}
                  </h3>
                  {user && managingCircle.owner_id === user.id ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700 border border-indigo-200/60 inline-flex items-center gap-1">
                      <Shield className="w-2.5 h-2.5" />
                      Owner
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">
                      Member
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Manage members, sharing, and circle membership
                </p>
              </div>

              <button
                type="button"
                onClick={() => setManagingCircle(null)}
                className="p-1 rounded-full text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message in Modal */}
            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-2xl text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Members Section */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Members
                </span>
                <span className="text-[11px] font-semibold text-slate-400">
                  {circleMembers.length} {circleMembers.length === 1 ? "person" : "people"}
                </span>
              </div>

              {membersLoading ? (
                <div className="p-4 text-center text-xs text-slate-400 flex items-center justify-center gap-2 bg-slate-50 rounded-2xl">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                  <span>Loading members...</span>
                </div>
              ) : circleMembers.length === 0 ? (
                <div className="p-3 text-center text-xs text-slate-400 bg-slate-50 rounded-2xl">
                  No members found in this circle.
                </div>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {circleMembers.map((m) => {
                    const isMemberOwner = m.id === managingCircle.owner_id;
                    const isSelf = user?.id === m.id;

                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50/70 border border-slate-100 text-xs"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div
                            className="w-7 h-7 text-white font-extrabold text-[11px] flex items-center justify-center overflow-hidden shrink-0"
                            style={{ 
                              backgroundColor: m.avatar_color || "#4f46e5",
                              clipPath: "url(#squircle-clip-app)"
                            }}
                          >
                            {m.profile_picture_url ? (
                              <img
                                src={m.profile_picture_url}
                                alt={m.display_name}
                                className="w-full h-full object-cover"
                                style={{ clipPath: "url(#squircle-clip-app)" }}
                              />
                            ) : (
                              m.display_name?.charAt(0).toUpperCase() || <User className="w-3.5 h-3.5" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="font-bold text-slate-800 truncate">
                              {m.display_name} {isSelf && <span className="text-indigo-600 font-semibold">(You)</span>}
                            </div>
                            <div className="text-[10px] text-slate-400 truncate">
                              @{m.username}
                            </div>
                          </div>
                        </div>

                        {isMemberOwner && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                            Owner
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Invite Code Section */}
            <div className="space-y-2">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Invite Code
              </span>

              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100 flex items-center justify-between gap-3">
                <span className="font-mono font-black text-slate-800 tracking-wider text-sm select-all">
                  {managingCircle.invite_code}
                </span>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleCopyCode(managingCircle.invite_code)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-700 hover:text-indigo-600 border border-slate-200/80 hover:border-indigo-200 transition flex items-center gap-1 cursor-pointer shadow-2xs"
                  >
                    {copied ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span className="text-emerald-600">Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Code</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowQRModal(true)}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-700 hover:text-indigo-600 border border-slate-200/80 hover:border-indigo-200 transition flex items-center gap-1 cursor-pointer shadow-2xs"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>QR Code</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Divider */}
            <hr className="border-slate-100 my-2" />

            {/* Leave Family Circle Section */}
            <div>
              {user && managingCircle.owner_id === user.id ? (
                <div className="space-y-3">
                  <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/60 space-y-1">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-amber-800">
                      <Shield className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>Circle Owner Protection</span>
                    </div>
                    <p className="text-[11px] text-amber-700/90 leading-relaxed">
                      As the owner of this Family Circle, you cannot leave it. Circle owners must remain with the circle or delete it permanently below.
                    </p>
                  </div>

                  {/* Delete Family Circle (Owner/Admin Only) */}
                  {onDeleteCircle && (
                    <div className="pt-2 border-t border-slate-100 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-slate-700 uppercase tracking-wider">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                        <span>Destructive Action</span>
                      </div>
                      <div className="p-3.5 rounded-2xl bg-rose-50/50 border border-rose-100 space-y-2.5">
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Permanently delete this Family Circle, remove all member associations, and revoke its invite code.
                        </p>
                        <button
                          type="button"
                          onClick={() => setShowDeleteConfirm(true)}
                          disabled={actionLoading}
                          className="w-full py-2.5 px-4 rounded-2xl text-xs font-bold text-rose-600 hover:text-white hover:bg-rose-600 bg-white border border-rose-200 transition shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.99]"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Delete Family Circle</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowLeaveConfirm(true)}
                    disabled={actionLoading}
                    className="w-full py-2.5 px-4 rounded-2xl text-xs font-bold text-rose-600 hover:text-rose-700 bg-rose-50 hover:bg-rose-100/70 border border-rose-200/70 transition flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Leave Family Circle</span>
                  </button>
                  <p className="text-[10px] text-slate-400 text-center">
                    You will no longer receive location updates from members in this circle.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 4. LEAVE CIRCLE CONFIRMATION MODAL */}
      {showLeaveConfirm && managingCircle && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto pointer-events-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 text-center space-y-4 my-auto max-h-[calc(100dvh-2.5rem)] overflow-y-auto">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-50 text-rose-600 flex items-center justify-center">
              <LogOut className="w-6 h-6" />
            </div>

            <div className="space-y-1.5">
              <h4 className="text-base font-extrabold text-slate-800">
                Leave {managingCircle.name}?
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                You will no longer see this circle's shared people and devices.
              </p>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium">
                {formError}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleLeave}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-sm flex items-center justify-center gap-1 cursor-pointer"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Leaving...</span>
                  </>
                ) : (
                  <span>Leave Circle</span>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 4b. DELETE CIRCLE CONFIRMATION MODAL (Owner/Admin Only) */}
      {showDeleteConfirm && managingCircle && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto pointer-events-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 text-center space-y-4 my-auto max-h-[calc(100dvh-2.5rem)] overflow-y-auto">
            <div className="w-12 h-12 mx-auto rounded-full bg-rose-100 text-rose-600 flex items-center justify-center shadow-xs">
              <Trash2 className="w-6 h-6" />
            </div>

            <div className="space-y-2">
              <h4 className="text-base font-extrabold text-slate-800">
                Delete Family Circle?
              </h4>
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                This will permanently delete this Family Circle and its membership/sharing settings. It will not delete your Yimly account or Core devices.
              </p>
            </div>

            {formError && (
              <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl text-xs font-medium text-left">
                {formError}
              </div>
            )}

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setFormError(null);
                }}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleDelete}
                disabled={actionLoading}
                className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 transition shadow-sm flex items-center justify-center gap-1 cursor-pointer active:scale-[0.99]"
              >
                {actionLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Deleting...</span>
                  </>
                ) : (
                  <span>Delete Circle</span>
                )}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* 5. CREATE CIRCLE MODAL */}
      {showCreateModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto pointer-events-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4 my-auto max-h-[calc(100dvh-2.5rem)] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Plus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">
                  Create Family Circle
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Create a private circle for family or household members to share real-time locations and devices.
            </p>

            {formError && (
              <div className="text-xs bg-rose-50 border border-rose-100 text-rose-600 p-3 rounded-2xl">
                {formError}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                  Circle Name
                </label>
                <input
                  type="text"
                  placeholder="e.g. Smith Family, Downtown Home"
                  value={newCircleName}
                  onChange={(e) => setNewCircleName(e.target.value)}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !newCircleName.trim()}
                  className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm flex items-center justify-center gap-1 cursor-pointer"
                >
                  {actionLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating...</span>
                    </>
                  ) : (
                    <span>Create Circle</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 6. JOIN CIRCLE MODAL */}
      {showJoinModal && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto pointer-events-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4 my-auto max-h-[calc(100dvh-2.5rem)] overflow-y-auto">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <ArrowUpRight className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-bold text-slate-800">
                  Join Family Circle
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setShowJoinModal(false)}
                className="text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Enter an invite code provided by a circle member or owner to join their Family Circle.
            </p>

            {formError && (
              <div className="text-xs bg-rose-50 border border-rose-200 text-rose-700 p-3 rounded-2xl font-medium">
                {formError}
              </div>
            )}

            {formSuccess && (
              <div className="text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 p-3 rounded-2xl font-medium flex items-center gap-1.5">
                <Check className="w-4 h-4 text-emerald-600" />
                <span>{formSuccess}</span>
              </div>
            )}

            <form onSubmit={handleJoin} className="space-y-4">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1.5">
                  Invitation Code
                </label>
                <input
                  type="text"
                  placeholder="e.g. YIMLY-ABC123"
                  value={joinInviteCode}
                  onChange={(e) => setJoinInviteCode(e.target.value.toUpperCase())}
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-800 font-mono tracking-wider focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition uppercase"
                  autoFocus
                  required
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowJoinModal(false)}
                  className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading || !joinInviteCode.trim()}
                  className="flex-1 py-2.5 rounded-2xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 transition shadow-sm flex items-center justify-center gap-1 cursor-pointer"
                >
                  {actionLoading ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Joining...</span>
                    </>
                  ) : (
                    <span>Join Circle</span>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* 7. QR CODE MODAL */}
      {showQRModal && managingCircle && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center p-4 sm:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto pointer-events-auto">
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl border border-slate-100 text-center space-y-4 my-auto max-h-[calc(100dvh-2.5rem)] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-bold text-slate-800">Circle QR Code</h3>
              <button
                type="button"
                onClick={() => setShowQRModal(false)}
                className="text-slate-400 hover:text-slate-600 transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Scan with camera to join <strong className="text-slate-700">{managingCircle.name}</strong>
            </p>

            <div className="bg-slate-50 p-4 rounded-3xl border border-slate-100 inline-block">
              <img
                src={qrCodeUrl}
                alt="Circle Invite QR Code"
                className="w-48 h-48 mx-auto rounded-xl"
              />
            </div>

            <div className="bg-indigo-50 text-indigo-700 px-4 py-2.5 rounded-2xl border border-indigo-100 text-sm font-mono font-bold tracking-widest select-all">
              {managingCircle.invite_code}
            </div>

            <button
              type="button"
              onClick={() => setShowQRModal(false)}
              className="w-full py-2.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition cursor-pointer"
            >
              Done
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};
