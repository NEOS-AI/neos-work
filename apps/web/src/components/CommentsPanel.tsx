import { useCallback, useEffect, useState } from 'react';
import { ApiError, type PreviewComment } from '../lib/api.js';
import { scrubError } from '../lib/scrub.js';

type CommentsClient = {
  listPreviewComments(
    projectId: string,
    filePath?: string,
  ): Promise<{ ok: boolean; data?: PreviewComment[]; error?: string }>;
  createPreviewComment(
    projectId: string,
    input: { filePath: string; selector: string; body: string },
  ): Promise<{ ok: boolean; data?: PreviewComment; error?: string }>;
  deletePreviewComment(
    projectId: string,
    commentId: string,
  ): Promise<{ ok: boolean; error?: string }>;
};

export type CommentsPanelProps = {
  projectId: string;
  filePath: string | null | undefined;
  selectionSelector: string | null | undefined;
  client: CommentsClient;
};

/**
 * Preview comments for the open file (list / add / delete).
 * Owns commentBody / busy / error and reloads when projectId or filePath changes.
 */
export function CommentsPanel({
  projectId,
  filePath,
  selectionSelector,
  client,
}: CommentsPanelProps) {
  const [comments, setComments] = useState<PreviewComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    if (!projectId) {
      setComments([]);
      return;
    }
    try {
      const res = await client.listPreviewComments(projectId, filePath ?? undefined);
      if (res.ok && Array.isArray(res.data)) {
        setComments(res.data);
      } else {
        setComments([]);
      }
    } catch {
      setComments([]);
    }
  }, [client, projectId, filePath]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  const handleAddComment = async () => {
    if (!projectId || commentBusy) return;
    if (!filePath) {
      setCommentError('Open a file to comment');
      return;
    }
    if (!selectionSelector) {
      setCommentError('Select an element first');
      return;
    }
    const body = commentBody;
    if (typeof body !== 'string' || !body.trim() || /\0/.test(body)) {
      setCommentError('Invalid comment body');
      return;
    }
    setCommentBusy(true);
    setCommentError(null);
    try {
      const res = await client.createPreviewComment(projectId, {
        filePath,
        selector: selectionSelector,
        body: body.trim(),
      });
      if (!res.ok) {
        setCommentError(scrubError(res.error, 'Failed to add comment'));
        return;
      }
      setCommentBody('');
      await loadComments();
    } catch (err) {
      setCommentError(
        scrubError(
          err instanceof ApiError ? err.message : 'Failed to add comment',
          'Failed to add comment',
        ),
      );
    } finally {
      setCommentBusy(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!projectId || commentBusy) return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      const res = await client.deletePreviewComment(projectId, commentId);
      if (!res.ok) {
        setCommentError(scrubError(res.error, 'Failed to delete comment'));
        return;
      }
      await loadComments();
    } catch (err) {
      setCommentError(
        scrubError(
          err instanceof ApiError ? err.message : 'Failed to delete comment',
          'Failed to delete comment',
        ),
      );
    } finally {
      setCommentBusy(false);
    }
  };

  return (
    <div
      data-testid="web-comments"
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: '1px solid var(--border, #333)',
      }}
    >
      <div className="muted" style={{ marginBottom: 8 }}>
        Comments
        {filePath ? (
          <span className="mono" style={{ marginLeft: 6, fontSize: 11 }}>
            {filePath}
          </span>
        ) : null}
      </div>
      {!filePath ? (
        <p className="muted" style={{ fontSize: 11, margin: 0 }}>
          Open a file to list comments.
        </p>
      ) : (
        <>
          <div className="stack" style={{ gap: 6, marginBottom: 8 }}>
            <div className="mono muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>
              {selectionSelector
                ? `selector: ${selectionSelector}`
                : 'Select a layer/element to attach a comment'}
            </div>
            <textarea
              className="input"
              style={{ minHeight: 56, resize: 'vertical', fontSize: 12 }}
              placeholder="Comment on selection…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              data-testid="web-comment-body"
              disabled={commentBusy}
            />
            <button
              type="button"
              className="btn"
              style={{ fontSize: 11, alignSelf: 'flex-start' }}
              disabled={
                commentBusy
                || !commentBody.trim()
                || !selectionSelector
                || !filePath
              }
              data-testid="web-comment-add"
              onClick={() => void handleAddComment()}
            >
              {commentBusy ? '…' : 'Add comment'}
            </button>
            {commentError && (
              <p
                className="err"
                role="alert"
                data-testid="web-comment-error"
                style={{ margin: 0, fontSize: 11 }}
              >
                {commentError}
              </p>
            )}
          </div>
          {comments.length === 0 ? (
            <p className="muted" style={{ fontSize: 11, margin: 0 }}>
              No comments on this file.
            </p>
          ) : (
            <ul
              className="list"
              style={{ margin: 0, padding: 0, listStyle: 'none' }}
              data-testid="web-comment-list"
            >
              {comments.map((c) => (
                <li
                  key={c.id}
                  data-testid={`web-comment-${c.id}`}
                  style={{
                    padding: '0.35rem 0',
                    borderBottom: '1px solid var(--border, #2a2a2a)',
                    fontSize: 11,
                  }}
                >
                  <div className="mono muted" style={{ fontSize: 10, wordBreak: 'break-all' }}>
                    {c.selector}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {(c.body || '').replace(/\0/g, '').slice(0, 500)}
                  </div>
                  <div className="row" style={{ marginTop: 4, gap: 8 }}>
                    <span className="muted" style={{ fontSize: 10 }}>
                      {c.createdAt}
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{
                        fontSize: 10,
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'pointer',
                        color: 'var(--danger, #f87171)',
                      }}
                      disabled={commentBusy}
                      data-testid={`web-comment-delete-${c.id}`}
                      onClick={() => void handleDeleteComment(c.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
