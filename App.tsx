
import React from 'react';
import CriptLatorWidget from './components/CriptLatorWidget';

const App: React.FC = () => {
  return (
    <div className="min-h-screen bg-transparent flex items-center justify-center">
      <div className="p-10">
        <CriptLatorWidget />
      </div>
      
      {/* Background decoration for the "demo" feeling */}
      <div className="fixed inset-0 -z-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-900 via-black to-black opacity-90"></div>
      <div className="fixed top-0 left-0 w-full p-4 pointer-events-none">
        <div className="text-white font-black text-4xl opacity-5 select-none uppercase tracking-[1em]">
          CriptLator
        </div>
      </div>
    </div>
  );
};

export default App;
