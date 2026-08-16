import { act, fireEvent, render, screen } from '@testing-library/react';
import { ResumeViewer } from '../resume-viewer';

const secondRender = deferred<void>();
let renderNumber = 0;

const page = {
  getViewport: ({ scale }: { scale: number }) => ({
    width: 100 * scale,
    height: 200 * scale,
  }),
  getTextContent: jest.fn().mockResolvedValue({ items: [], styles: {} }),
  render: jest.fn(() => {
    renderNumber += 1;
    return {
      cancel: jest.fn(),
      promise: renderNumber === 1 ? Promise.resolve() : secondRender.promise,
    };
  }),
};

jest.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: jest.fn(() => ({
    destroy: jest.fn(),
    promise: Promise.resolve({
      numPages: 1,
      getPage: jest.fn().mockResolvedValue(page),
    }),
  })),
  TextLayer: class {
    render() {
      return Promise.resolve();
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ResumeViewer zoom rendering', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    renderNumber = 0;
    page.render.mockClear();

    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(8)),
    }) as jest.Mock;

    global.ResizeObserver = class {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe() {
        this.callback(
          [{ contentRect: { width: 100 } } as unknown as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }

      disconnect() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('keeps the previous visible canvas intact until the sharper raster is ready', async () => {
    const { container } = render(
      <ResumeViewer applicationId="application-1" applicantName="Ada" hasResume />,
    );

    await flushPromises();
    act(() => jest.advanceTimersByTime(180));
    await flushPromises();

    const visibleCanvas = container.querySelector('canvas');
    expect(visibleCanvas).not.toBeNull();
    expect(visibleCanvas).toHaveAttribute('width', '100');

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    act(() => jest.advanceTimersByTime(180));
    await flushPromises();

    expect(page.render).toHaveBeenCalledTimes(2);
    expect(container.querySelector('canvas')).toBe(visibleCanvas);
    expect(visibleCanvas).toHaveAttribute('width', '100');
  });
});
