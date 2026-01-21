import React, { useState, useEffect } from 'react';
import { Upload, FileText, AlertCircle, CheckCircle, Send, Plus, Search, Loader } from 'lucide-react';

const App = () => {
  const [activeTab, setActiveTab] = useState('upload');
  const [documents, setDocuments] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [analyzedIssues, setAnalyzedIssues] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState(null);
  const [generatingResponse, setGeneratingResponse] = useState(null);
  const [pdfJsLoaded, setPdfJsLoaded] = useState(false);

  // Load PDF.js library
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.async = true;
    script.onload = () => {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      setPdfJsLoaded(true);
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // Extract text from PDF using pdf.js
  const extractPDFText = async (file) => {
    if (!window.pdfjsLib) {
      throw new Error('PDF.js library not loaded yet');
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n--- Page ${i} ---\n${pageText}\n`;
    }
    
    return fullText;
  };

  const callClaude = async (payload) => {
    const response = await fetch("/api/anthropic/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = data?.error?.message || data?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    return data;
  };

  // Analyze document using Claude API
  const analyzeDocumentWithClaude = async (text, fileName) => {
    try {
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: `You are analyzing a construction tender document. Review the following text and identify potential issues that might need clarification.

Document: ${fileName}

Text:
${text.substring(0, 15000)} ${text.length > 15000 ? '...(truncated)' : ''}

Please identify:
1. Inconsistencies (conflicting information)
2. Missing information (incomplete specifications)
3. Ambiguities (unclear requirements)
4. Contradictions (conflicting requirements)

For each issue found, provide:
- Type (Inconsistency/Missing Information/Ambiguity/Contradiction)
- Severity (high/medium/low)
- Description (brief explanation)
- Location (where in the document)
- A professionally worded clarification question

Respond ONLY with a JSON array in this exact format, no other text:
[
  {
    "type": "Inconsistency",
    "severity": "high",
    "description": "Brief description of the issue",
    "location": "Section or page reference",
    "suggestedQuestion": "Professional clarification question"
  }
]`
          }
        ],
      });

      if (data.content && data.content[0]) {
        const text = data.content[0].text;
        // Extract JSON from response, removing any markdown formatting
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const issues = JSON.parse(jsonMatch[0]);
          return issues.map((issue, index) => ({
            ...issue,
            id: Date.now() + index,
            sourceFile: fileName
          }));
        }
      }

      return [];
    } catch (err) {
      console.error('Claude API Error:', err);
      throw new Error(`Failed to analyze document with AI: ${err.message}`);
    }
  };

  // Analyze multiple documents with combined context
  const analyzeMultipleDocuments = async (docsToAnalyze) => {
    try {
      // Combine text from all selected documents
      const combinedText = docsToAnalyze
        .map(doc => `\n=== ${doc.name} ===\n${doc.text}`)
        .join('\n');
      
      const fileNames = docsToAnalyze.map(doc => doc.name).join(', ');

      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 6000,
        messages: [
          {
            role: "user",
            content: `You are analyzing construction tender documents. Review the following texts and identify potential issues that might need clarification. Pay special attention to inconsistencies ACROSS documents.

Documents: ${fileNames}

Text:
${combinedText.substring(0, 25000)} ${combinedText.length > 25000 ? '...(truncated)' : ''}

Please identify:
1. Inconsistencies (conflicting information within or across documents)
2. Missing information (incomplete specifications)
3. Ambiguities (unclear requirements)
4. Contradictions (conflicting requirements)
5. Cross-document conflicts (differences between multiple tender documents)

For each issue found, provide:
- Type (Inconsistency/Missing Information/Ambiguity/Contradiction/Cross-Document Conflict)
- Severity (high/medium/low)
- Description (brief explanation)
- Location (where in the documents)
- A professionally worded clarification question

Respond ONLY with a JSON array in this exact format, no other text:
[
  {
    "type": "Inconsistency",
    "severity": "high",
    "description": "Brief description of the issue",
    "location": "Section or page reference",
    "suggestedQuestion": "Professional clarification question"
  }
]`
          }
        ],
      });

      if (data.content && data.content[0]) {
        const text = data.content[0].text;
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const issues = JSON.parse(jsonMatch[0]);
          return issues.map((issue, index) => ({
            ...issue,
            id: Date.now() + index,
            sourceFiles: fileNames
          }));
        }
      }

      return [];
    } catch (err) {
      console.error('Claude API Error:', err);
      throw new Error(`Failed to analyze documents with AI: ${err.message}`);
    }
  };

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    setError(null);

    if (!pdfJsLoaded) {
      setError('PDF library is still loading. Please wait a moment and try again.');
      return;
    }
    
    // Just add files to the list without auto-analyzing
    for (const file of files) {
      if (file.type !== 'application/pdf') {
        setError('Please upload PDF files only');
        continue;
      }

      try {
        // Extract text from PDF
        const text = await extractPDFText(file);
        
        // Add document to list
        const newDoc = {
          id: Date.now(),
          name: file.name,
          size: (file.size / 1024).toFixed(2) + ' KB',
          type: file.type,
          uploadedAt: new Date().toLocaleString(),
          text: text
        };
        setDocuments(prev => [...prev, newDoc]);
        setSelectedDocs(prev => new Set([...prev, newDoc.id]));
        
      } catch (err) {
        console.error('Error processing file:', err);
        setError(`Failed to process ${file.name}: ${err.message}`);
      }
    }
  };

  const toggleDocumentSelection = (docId) => {
    const newSelected = new Set(selectedDocs);
    if (newSelected.has(docId)) {
      newSelected.delete(docId);
    } else {
      newSelected.add(docId);
    }
    setSelectedDocs(newSelected);
  };

  const handleBatchAnalysis = async () => {
    if (selectedDocs.size === 0) {
      setError('Please select at least one document to analyze');
      return;
    }

    const docsToAnalyze = documents.filter(doc => selectedDocs.has(doc.id));
    
    try {
      setIsAnalyzing(true);
      setError(null);
      
      if (docsToAnalyze.length === 1) {
        // Single document analysis
        const issues = await analyzeDocumentWithClaude(docsToAnalyze[0].text, docsToAnalyze[0].name);
        setAnalyzedIssues(prev => [...prev, ...issues]);
      } else {
        // Multiple document analysis with combined context
        const issues = await analyzeMultipleDocuments(docsToAnalyze);
        setAnalyzedIssues(prev => [...prev, ...issues]);
      }
      
      setIsAnalyzing(false);
      setActiveTab('issues');
      
    } catch (err) {
      console.error('Error analyzing documents:', err);
      setError(`Failed to analyze documents: ${err.message}`);
      setIsAnalyzing(false);
    }
  };

  const addQuestionFromIssue = (issue) => {
    const newQuestion = {
      id: Date.now(),
      text: issue.suggestedQuestion,
      relatedIssue: issue.id,
      issueType: issue.type,
      status: 'draft',
      submittedBy: 'System Generated',
      createdAt: new Date().toLocaleString()
    };
    setQuestions([...questions, newQuestion]);
    setActiveTab('questions');
  };

  const generateAIResponse = async (questionId) => {
    setGeneratingResponse(questionId);
    const question = questions.find(q => q.id === questionId);
    
    try {
      const data = await callClaude({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [
          {
            role: "user",
            content: `You are a construction project manager responding to a tender clarification question. 

Question: ${question.text}

Provide a professional, clear, and helpful response that:
1. Addresses the question directly
2. Provides specific information
3. References relevant sections/standards if applicable
4. Maintains a professional tone

Respond with ONLY the clarification response text, no additional formatting or preamble.`
          }
        ],
      });

      if (data.content && data.content[0]) {
        const aiResponse = data.content[0].text;

        setQuestions(questions.map(q => 
          q.id === questionId 
            ? { ...q, aiResponse: aiResponse, status: 'responded' }
            : q
        ));
      }
    } catch (err) {
      console.error('Error generating response:', err);
      setError(`Failed to generate AI response: ${err.message}`);
    } finally {
      setGeneratingResponse(null);
    }
  };

  const getSeverityColor = (severity) => {
    switch(severity) {
      case 'high': return 'bg-red-100 text-red-800 border-red-300';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      case 'low': return 'bg-blue-100 text-blue-800 border-blue-300';
      default: return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto p-6 max-w-7xl">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">
                Tender Clarification System
              </h1>
              <p className="text-gray-600">AI-powered document analysis using Claude API</p>
            </div>
            <FileText className="w-16 h-16 text-indigo-600" />
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start">
            <AlertCircle className="w-5 h-5 text-red-600 mr-3 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-red-800 font-medium">Error</p>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="flex border-b">
            <button
              onClick={() => setActiveTab('upload')}
              className={`px-6 py-4 font-medium transition-colors ${
                activeTab === 'upload'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-indigo-600'
              }`}
            >
              <Upload className="w-5 h-5 inline mr-2" />
              Upload Documents
            </button>
            <button
              onClick={() => setActiveTab('issues')}
              className={`px-6 py-4 font-medium transition-colors ${
                activeTab === 'issues'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-indigo-600'
              }`}
            >
              <AlertCircle className="w-5 h-5 inline mr-2" />
              Identified Issues ({analyzedIssues.length})
            </button>
            <button
              onClick={() => setActiveTab('questions')}
              className={`px-6 py-4 font-medium transition-colors ${
                activeTab === 'questions'
                  ? 'text-indigo-600 border-b-2 border-indigo-600'
                  : 'text-gray-600 hover:text-indigo-600'
              }`}
            >
              <Search className="w-5 h-5 inline mr-2" />
              Questions ({questions.length})
            </button>
          </div>

          <div className="p-6">
            {/* Upload Tab */}
            {activeTab === 'upload' && (
              <div>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-indigo-500 transition-colors">
                  <input
                    type="file"
                    multiple
                    accept=".pdf"
                    onChange={handleFileUpload}
                    className="hidden"
                    id="file-upload"
                    disabled={isAnalyzing || !pdfJsLoaded}
                  />
                  <label htmlFor="file-upload" className={`cursor-pointer ${isAnalyzing || !pdfJsLoaded ? 'opacity-50' : ''}`}>
                    <Upload className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                    <p className="text-lg font-medium text-gray-700 mb-2">
                      Upload Tender Documents
                    </p>
                    <p className="text-sm text-gray-500">
                      {pdfJsLoaded ? 'PDF files only • Real AI analysis with Claude' : 'Loading PDF library...'}
                    </p>
                  </label>
                </div>

                {isAnalyzing && (
                  <div className="mt-6 bg-indigo-50 rounded-lg p-6 text-center">
                    <Loader className="animate-spin w-8 h-8 text-indigo-600 mx-auto mb-3" />
                    <p className="text-indigo-700 font-medium mb-1">Analyzing document with Claude AI...</p>
                    <p className="text-indigo-600 text-sm">This may take 10-30 seconds</p>
                  </div>
                )}

                {documents.length > 0 && (
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-4">Uploaded Documents</h3>
                    <div className="space-y-3 mb-4">
                      {documents.map(doc => (
                        <div key={doc.id} className="flex items-center justify-between bg-gray-50 rounded-lg p-4 cursor-pointer hover:bg-gray-100" onClick={() => toggleDocumentSelection(doc.id)}>
                          <div className="flex items-center flex-1">
                            <input
                              type="checkbox"
                              checked={selectedDocs.has(doc.id)}
                              onChange={() => toggleDocumentSelection(doc.id)}
                              onClick={(e) => e.stopPropagation()}
                              className="w-5 h-5 text-indigo-600 rounded cursor-pointer mr-3"
                            />
                            <FileText className="w-8 h-8 text-indigo-600 mr-3" />
                            <div>
                              <p className="font-medium text-gray-800">{doc.name}</p>
                              <p className="text-sm text-gray-500">{doc.size} • {doc.uploadedAt}</p>
                            </div>
                          </div>
                          <CheckCircle className="w-6 h-6 text-green-500" />
                        </div>
                      ))}
                    </div>
                    
                    {documents.length > 0 && (
                      <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                        <p className="text-sm text-blue-800 mb-3">
                          <span className="font-semibold">{selectedDocs.size}</span> document{selectedDocs.size !== 1 ? 's' : ''} selected
                        </p>
                        <button
                          onClick={handleBatchAnalysis}
                          disabled={isAnalyzing || selectedDocs.size === 0}
                          className="w-full bg-indigo-600 text-white px-6 py-3 rounded-lg hover:bg-indigo-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isAnalyzing ? (
                            <div className="flex items-center justify-center space-x-2">
                              <Loader className="animate-spin w-5 h-5" />
                              <span>Analyzing with Claude AI...</span>
                            </div>
                          ) : (
                            <span>Analyze {selectedDocs.size} {selectedDocs.size === 1 ? 'Document' : 'Documents'} Together</span>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Issues Tab */}
            {activeTab === 'issues' && (
              <div>
                {analyzedIssues.length === 0 ? (
                  <div className="text-center py-12">
                    <AlertCircle className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No issues identified yet. Upload a PDF document to begin analysis.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">AI-Identified Issues</h3>
                      <span className="text-sm text-gray-500">
                        {analyzedIssues.length} potential issues found
                      </span>
                    </div>
                    {analyzedIssues.map(issue => (
                      <div key={issue.id} className="border rounded-lg p-5 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center space-x-3">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium border ${getSeverityColor(issue.severity)}`}>
                              {issue.severity.toUpperCase()}
                            </span>
                            <span className="text-sm font-medium text-gray-600">{issue.type}</span>
                          </div>
                          <AlertCircle className={`w-5 h-5 ${
                            issue.severity === 'high' ? 'text-red-500' : 'text-yellow-500'
                          }`} />
                        </div>
                        <p className="font-medium text-gray-800 mb-2">{issue.description}</p>
                        <p className="text-sm text-gray-600 mb-4">
                          <span className="font-medium">Location:</span> {issue.location}
                        </p>
                        <div className="bg-blue-50 rounded-lg p-4 mb-3">
                          <p className="text-sm font-medium text-gray-700 mb-2">Suggested Clarification Question:</p>
                          <p className="text-sm text-gray-700">{issue.suggestedQuestion}</p>
                        </div>
                        <button
                          onClick={() => addQuestionFromIssue(issue)}
                          className="flex items-center space-x-2 text-indigo-600 hover:text-indigo-700 font-medium text-sm"
                        >
                          <Plus className="w-4 h-4" />
                          <span>Add to Questions</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Questions Tab */}
            {activeTab === 'questions' && (
              <div>
                {questions.length === 0 ? (
                  <div className="text-center py-12">
                    <Search className="w-16 h-16 text-gray-300 mx-auto mb-4" />
                    <p className="text-gray-500">No questions yet. Add questions from identified issues.</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold">Clarification Questions</h3>
                      <span className="text-sm text-gray-500">
                        {questions.length} questions
                      </span>
                    </div>
                    {questions.map(question => (
                      <div key={question.id} className="border rounded-lg p-5 hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center space-x-2">
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              question.status === 'responded' 
                                ? 'bg-green-100 text-green-800' 
                                : 'bg-gray-100 text-gray-800'
                            }`}>
                              {question.status}
                            </span>
                            <span className="text-xs text-gray-500">{question.issueType}</span>
                          </div>
                          <span className="text-xs text-gray-500">{question.createdAt}</span>
                        </div>
                        <p className="text-gray-800 mb-3 font-medium">{question.text}</p>
                        
                        {question.aiResponse && (
                          <div className="bg-green-50 rounded-lg p-4 mb-3 border border-green-200">
                            <p className="text-sm font-medium text-green-800 mb-2">AI-Generated Response:</p>
                            <p className="text-sm text-gray-700 whitespace-pre-line">{question.aiResponse}</p>
                          </div>
                        )}
                        
                        <div className="flex space-x-3">
                          {!question.aiResponse && (
                            <button
                              onClick={() => generateAIResponse(question.id)}
                              disabled={generatingResponse === question.id}
                              className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm disabled:opacity-50"
                            >
                              {generatingResponse === question.id ? (
                                <>
                                  <Loader className="w-4 h-4 animate-spin" />
                                  <span>Generating...</span>
                                </>
                              ) : (
                                <>
                                  <Send className="w-4 h-4" />
                                  <span>Generate AI Response</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Stats Footer */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Documents Analyzed</p>
                <p className="text-2xl font-bold text-indigo-600">{documents.length}</p>
              </div>
              <FileText className="w-10 h-10 text-indigo-200" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Issues Identified</p>
                <p className="text-2xl font-bold text-yellow-600">{analyzedIssues.length}</p>
              </div>
              <AlertCircle className="w-10 h-10 text-yellow-200" />
            </div>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Questions Managed</p>
                <p className="text-2xl font-bold text-green-600">{questions.length}</p>
              </div>
              <CheckCircle className="w-10 h-10 text-green-200" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
