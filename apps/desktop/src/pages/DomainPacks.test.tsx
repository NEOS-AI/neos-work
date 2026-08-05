import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const listDomainPacks = vi.fn();
const installDomainPackFromPath = vi.fn();
const installDomainPackFromZip = vi.fn();
const validateDomainPackManifest = vi.fn();
const toggleDomainPack = vi.fn();
const deleteDomainPack = vi.fn();

const client = {
  listDomainPacks,
  installDomainPackFromPath,
  installDomainPackFromZip,
  validateDomainPackManifest,
  toggleDomainPack,
  deleteDomainPack,
};

vi.mock('../hooks/useEngine.js', () => ({
  useEngine: () => ({ client }),
}));

const { DomainPacks } = await import('./DomainPacks.js');

const samplePacks = [
  {
    id: 'coding',
    name: 'Coding',
    description: 'Built-in coding pack',
    workerCount: 3,
    blockCount: 5,
    isBuiltIn: true,
    enabled: true,
    version: '1.0.0',
  },
  {
    id: 'legal',
    name: 'Legal',
    description: 'Custom legal pack',
    workerCount: 1,
    blockCount: 2,
    isBuiltIn: false,
    enabled: true,
    version: '0.2.0',
  },
  {
    id: 'ops',
    name: 'Ops',
    description: 'Disabled custom',
    workerCount: 0,
    blockCount: 0,
    isBuiltIn: false,
    enabled: false,
  },
];

describe('DomainPacks page', () => {
  beforeEach(() => {
    listDomainPacks.mockReset();
    installDomainPackFromPath.mockReset();
    installDomainPackFromZip.mockReset();
    validateDomainPackManifest.mockReset();
    toggleDomainPack.mockReset();
    deleteDomainPack.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('lists packs after load', async () => {
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    render(<DomainPacks />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Coding')).toBeInTheDocument();
    });
    expect(screen.getByText('Legal')).toBeInTheDocument();
    expect(screen.getByText('built-in')).toBeInTheDocument();
    expect(screen.getAllByText('custom').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('disabled')).toBeInTheDocument();
    // built-in has no uninstall
    expect(screen.getAllByRole('button', { name: 'Uninstall' })).toHaveLength(2);
  });

  it('shows scrubbed load error', async () => {
    listDomainPacks.mockResolvedValue({
      ok: false,
      error: `load${'\n'}failed${'\0'}!`,
    });
    render(<DomainPacks />);
    await waitFor(() => {
      expect(screen.getByText('load failed!')).toBeInTheDocument();
    });
  });

  it('shows load error on throw', async () => {
    listDomainPacks.mockRejectedValue(new Error('network down'));
    render(<DomainPacks />);
    await waitFor(() => {
      expect(screen.getByText(/network down/i)).toBeInTheDocument();
    });
  });

  it('validates install path and installs successfully', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    installDomainPackFromPath.mockResolvedValue({ ok: true, data: { id: 'legal' } });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByText('Coding')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Install' }));
    expect(screen.getByText(/Enter a local directory path/i)).toBeInTheDocument();
    expect(installDomainPackFromPath).not.toHaveBeenCalled();

    const input = screen.getByPlaceholderText('/path/to/my-pack');
    await user.type(input, '/tmp/my-pack');
    await user.click(screen.getByRole('button', { name: 'Install' }));

    await waitFor(() => {
      expect(installDomainPackFromPath).toHaveBeenCalledWith('/tmp/my-pack');
    });
    await waitFor(() => {
      expect(screen.getByText(/Installed pack successfully/i)).toBeInTheDocument();
    });
    expect(listDomainPacks.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('shows install API failure and throw', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: [] });
    installDomainPackFromPath.mockResolvedValueOnce({
      ok: false,
      error: `bad${'\n'}manifest`,
    });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());

    const input = screen.getByPlaceholderText('/path/to/my-pack');
    await user.type(input, '/tmp/x');
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(screen.getByText('bad manifest')).toBeInTheDocument());

    installDomainPackFromPath.mockRejectedValueOnce(new Error('disk full'));
    await user.clear(input);
    await user.type(input, '/tmp/y');
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => expect(screen.getByText(/disk full/i)).toBeInTheDocument());
  });

  it('rejects whitespace-only install path', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: [] });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument());
    const input = screen.getByPlaceholderText('/path/to/my-pack');
    fireEvent.change(input, { target: { value: '   ' } });
    await user.click(screen.getByRole('button', { name: 'Install' }));
    await waitFor(() => {
      expect(screen.getByText(/Enter a local directory path/i)).toBeInTheDocument();
    });
    expect(installDomainPackFromPath).not.toHaveBeenCalled();
  });

  it('toggles enable/disable on custom packs', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    toggleDomainPack.mockResolvedValue({ ok: true });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByText('Legal')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => {
      expect(toggleDomainPack).toHaveBeenCalledWith('legal', false);
    });

    await user.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => {
      expect(toggleDomainPack).toHaveBeenCalledWith('ops', true);
    });
  });

  it('shows toggle failure message', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    toggleDomainPack.mockResolvedValue({ ok: false, error: 'toggle denied' });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByText('Legal')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.getByText('toggle denied')).toBeInTheDocument());
  });

  it('uninstalls after confirm and respects cancel', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    deleteDomainPack.mockResolvedValue({ ok: true });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByText('Legal')).toBeInTheDocument());

    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await user.click(screen.getAllByRole('button', { name: 'Uninstall' })[0]!);
    expect(deleteDomainPack).not.toHaveBeenCalled();

    vi.mocked(window.confirm).mockReturnValueOnce(true);
    await user.click(screen.getAllByRole('button', { name: 'Uninstall' })[0]!);
    await waitFor(() => {
      expect(deleteDomainPack).toHaveBeenCalledWith('legal');
    });
  });

  it('shows uninstall failure', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    deleteDomainPack.mockResolvedValue({ ok: false, error: 'still in use' });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByText('Legal')).toBeInTheDocument());
    await user.click(screen.getAllByRole('button', { name: 'Uninstall' })[0]!);
    await waitFor(() => expect(screen.getByText('still in use')).toBeInTheDocument());
  });

  it('installs from zip file input', async () => {
    const user = userEvent.setup();
    listDomainPacks.mockResolvedValue({ ok: true, data: samplePacks });
    installDomainPackFromZip.mockResolvedValue({ ok: true, data: { id: 'from-zip' } });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByTestId('domain-pack-install-zip')).toBeInTheDocument());
    const input = screen.getByTestId('domain-pack-zip-input') as HTMLInputElement;
    const file = new File([new Uint8Array([0x50, 0x4b])], 'pack.zip', { type: 'application/zip' });
    await user.upload(input, file);
    await waitFor(() => {
      expect(installDomainPackFromZip).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('domain-pack-message')).toHaveTextContent(/from-zip/);
    });
  });

  it('validates pack.json via file input', async () => {
    listDomainPacks.mockResolvedValue({ ok: true, data: [] });
    validateDomainPackManifest.mockResolvedValue({
      ok: true,
      data: { id: 'demo', name: 'Demo Pack', workerCount: 2, blockCount: 3, version: '1.2.0' },
    });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByTestId('domain-pack-validate')).toBeInTheDocument());
    const input = screen.getByTestId('domain-pack-validate-input') as HTMLInputElement;
    const raw = JSON.stringify({ id: 'demo', name: 'Demo Pack', workers: [], blocks: [] });
    const file = new File([raw], 'pack.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => raw });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(validateDomainPackManifest).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByTestId('domain-pack-message')).toHaveTextContent(/Valid: Demo Pack/);
      expect(screen.getByTestId('domain-pack-message')).toHaveTextContent(/2 workers/);
    });
  });

  it('surfaces scrubbed validate and zip errors', async () => {
    listDomainPacks.mockResolvedValue({ ok: true, data: [] });
    validateDomainPackManifest.mockResolvedValue({
      ok: false,
      error: `invalid${'\n'}schema${'\0'}`,
    });
    render(<DomainPacks />);
    await waitFor(() => expect(screen.getByTestId('domain-pack-validate-input')).toBeInTheDocument());
    const vInput = screen.getByTestId('domain-pack-validate-input') as HTMLInputElement;
    const jsonFile = new File(['{"id":"x"}'], 'pack.json', { type: 'application/json' });
    Object.defineProperty(jsonFile, 'text', { value: async () => '{"id":"x"}' });
    fireEvent.change(vInput, { target: { files: [jsonFile] } });
    await waitFor(() => {
      expect(screen.getByTestId('domain-pack-message')).toHaveTextContent(/invalid schema/);
    });
    expect(document.body.textContent).not.toContain('\0');

    installDomainPackFromZip.mockResolvedValue({ ok: false, error: `zip${'\n'}bad` });
    const zInput = screen.getByTestId('domain-pack-zip-input') as HTMLInputElement;
    fireEvent.change(zInput, {
      target: {
        files: [new File([new Uint8Array([0x50, 0x4b])], 'pack.zip', { type: 'application/zip' })],
      },
    });
    await waitFor(() => {
      expect(screen.getByTestId('domain-pack-message')).toHaveTextContent(/zip bad/);
    });
  });
});
