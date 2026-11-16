import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(): void {
    // Intentionally avoid exposing internal stack details to the DOM
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="min-h-screen bg-[#F7F3E9] text-[#18221D] flex items-center justify-center p-6"
        >
          <div className="max-w-md w-full bg-white border border-[#E5E0D5] rounded-2xl p-8 text-center shadow-sm">
            <h1 className="text-xl font-extrabold text-[#104B34] mb-2">
              حدث خطأ غير متوقع
            </h1>
            <p className="text-sm text-[#4A5850] mb-6 leading-relaxed">
              نعتذر عن هذا العطل المؤقت. يمكنك إعادة تحميل الصفحة أو العودة للصفحة الرئيسية.
            </p>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="px-5 py-2.5 rounded-xl bg-[#104B34] text-white text-sm font-bold hover:bg-[#176B45] transition-colors"
            >
              العودة للرئيسية
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
