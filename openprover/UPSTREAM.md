# OpenProver integration

Panoptes runs [OpenProver](https://github.com/Kripner/openprover) 1.0.1 at commit
`e200251b34349ab6c34548d30319abde86cb6bc6` as its optional planner and worker engine.
OpenProver is Copyright 2026 Matěj Kripner and distributed under the MIT License.

The controller has no network access or provider credentials. It requests model calls and isolated
Lean checks from the Panoptes host over a line-delimited JSON protocol. The unmodified upstream
Python package is fetched at the pinned commit while building `panoptes-openprover:1.0.1`; its
optional CLI and MCP dependencies are not installed because this adapter does not use them.

## MIT License

Copyright 2026 Matěj Kripner

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
associated documentation files (the “Software”), to deal in the Software without restriction,
including without limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or
substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT
NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES
OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
