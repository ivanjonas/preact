import { createElement as h, Fragment } from '../../src/create-element';
import { render } from '../../src/render';
import { assign } from '../../src/util';
import { Component } from '../../src/component';
import { getDisplayName, setIn, isRoot, getPatchedRoot, getData, patchRoot, shallowEqual } from '../../src/devtools/custom';
import { setupScratch, setupRerender, teardown } from '../_util/helpers';
import { initDevTools } from '../../src/devtools';
import options from '../../src/options';
import { Renderer } from '../../src/devtools/renderer';

/** @jsx h */

/** @typedef {import('../../src/internal').DevtoolsHook & { log: any[], clear: () => void }} MockHook */

/**
 * Serialize a devtool event
 * @param {import('../../src/internal').DevtoolsEvent} event
 */
function serialize(event) {
	return {
		type: event.type,
		component: getDisplayName(event.internalInstance)
	};
}

/**
 * @returns {MockHook}
 */
function createMockHook() {
	let roots = new Set();

	/** @type {Array<import('../../src/internal').DevtoolsEvent>} */
	let events = [];

	function emit(ev, data) {
		if (ev=='renderer-attached') return;
		events.push(data);
	}

	function getFiberRoots() {
		return roots;
	}

	function clear() {
		roots.clear();
		events.length = 0;
	}

	let helpers = {};

	return {
		on() {},
		inject() { return 'abc'; },
		onCommitFiberRoot() {},
		onCommitFiberUnmount(rid, vnode) {
			if (helpers[rid]!=null) {
				helpers[rid].handleCommitFiberUnmount(vnode);
			}
		},
		_roots: roots,
		log: events,
		_renderers: {},
		helpers,
		clear,
		getFiberRoots,
		emit
	};
}

/**
 * Verify the references in the events passed to the devtools. Component have to
 * be traversed in a child-depth-first order for the devtools to work.
 * @param {Array<import('../../src/internal').DevtoolsEvent>} events
 */
function checkEventReferences(events) {
	let seen = new Set();

	events.forEach((event, i) => {
		if (i > 0 && event.type!=='unmount' && Array.isArray(event.data.children)) {
			event.data.children.forEach(child => {
				if (!seen.has(child)) {
					throw new Error(`Event at index ${i} has a child that could not be found in a preceeding event for component "${getDisplayName(child)}"`);
				}
			});
		}

		let inst = event.internalInstance;
		if (event.type=='mount') {
			seen.add(inst);
		}
		else if (!seen.has(inst)) {
			throw new Error(`Event at index ${i} for component ${inst!=null ? getDisplayName(inst) : inst} is not mounted. Perhaps you forgot to send a "mount" event prior to this?`);
		}

		// A "root" event must be a `Wrapper`, otherwise the
		// Profiler tree view will be messed up.
		if (event.type=='root' && event.data.nodeType!='Wrapper') {
			throw new Error(`Event of type "root" must be a "Wrapper". Found "${event.data.nodeType}" instead.`);
		}

		if (i==events.length - 1) {

			// Assert that the last child is of type `rootCommitted`
			if (event.type!='rootCommitted') {
				throw new Error(`The last event must be of type 'rootCommitted' for every committed tree`);
			}

			// Assert that the root node is a wrapper node (=Fragment). Otherwise the
			// Profiler tree view will be messed up.
			if (event.data.nodeType!=='Wrapper') {
				throw new Error(`The root node must be a "Wrapper" node (like a Fragment) for the Profiler to display correctly. Found "${event.data.nodeType}" instead.`);
			}
		}
	});
}

describe('devtools', () => {

	/** @type {import('../../src/internal').PreactElement} */
	let scratch;

	/** @type {() => void} */
	let rerender;

	/** @type {MockHook} */
	let hook;

	let oldOptions;

	beforeEach(() => {
		scratch = setupScratch();
		rerender = setupRerender();

		oldOptions = assign({}, options);

		hook = createMockHook();
		delete options.commitRoot;
		delete options.beforeUnmount;

		/** @type {import('../../src/internal').DevtoolsWindow} */
		(window).__REACT_DEVTOOLS_GLOBAL_HOOK__ = hook;

		initDevTools();
		let rid = Object.keys(hook._renderers)[0];

		// Trigger setter.
		hook.helpers[rid] = {};
		hook.clear();
	});

	afterEach(() => {
		teardown(scratch);

		delete /** @type {import('../../src/internal').DevtoolsWindow} */ (window).__REACT_DEVTOOLS_GLOBAL_HOOK__;
		assign(options, oldOptions);
	});

	describe('getDisplayName', () => {
		it('should get dom name', () => {
			expect(getDisplayName(h('div'))).to.equal('div');
		});

		it('should get Functional Component name', () => {
			function Foo() {
				return <div />;
			}

			expect(getDisplayName(h(Foo))).to.equal('Foo');
		});

		it('should get class name', () => {
			class Bar extends Component {
				render() {
					return <div />;
				}
			}

			expect(getDisplayName(h(Bar))).to.equal('Bar');
		});
	});

	describe('shallowEqual', () => {
		it('should compare objects', () => {
			expect(shallowEqual({ foo: 1 }, { foo: 2 })).to.equal(false);
			expect(shallowEqual({ foo: 1 }, { foo: 1 })).to.equal(true);
			expect(shallowEqual({ foo: 1, bar: 1 }, { foo: 1, bar: '2' })).to.equal(false);

			expect(shallowEqual({ foo: 1 }, { foo: 1, bar: '2' })).to.equal(false);
		});

		it('should skip children for props', () => {
			expect(shallowEqual({ foo: 1, children: 1 }, { foo: 1, children: '2' }, true)).to.equal(true);
		});
	});

	describe('setIn', () => {
		it('should set top property', () => {
			let obj = {};
			setIn(obj, ['foo'], 'bar');
			expect(obj).to.deep.equal({ foo: 'bar' });
		});

		it('should set deep property', () => {
			let obj2 = { foo: { bar: [{ baz: 1 }] } };
			setIn(obj2, ['foo', 'bar', 0, 'baz'], 2);
			expect(obj2).to.deep.equal({ foo: { bar: [{ baz: 2 }] } });
		});

		it('should overwrite property', () => {
			let obj = { foo: 'foo' };
			setIn(obj, ['foo'], 'bar');
			expect(obj).to.deep.equal({ foo: 'bar' });
		});

		it('should set array property', () => {
			let obj = { foo: ['foo'] };
			setIn(obj, ['foo', 0], 'bar');
			expect(obj).to.deep.equal({ foo: ['bar'] });
		});

		it('should return null on invalid obj', () => {
			expect(setIn(null, ['foo', 'bar'], 'bar')).to.equal(undefined);
		});
	});

	describe('isRoot', () => {
		it('should check if a vnode is a root', () => {
			render(<div>Hello World</div>, scratch);
			let root = scratch._previousVTree;

			expect(isRoot(root)).to.equal(true);
			expect(isRoot(root._children[0])).to.equal(false);
		});
	});

	describe('getPatchedRoot', () => {
		it('should get the root of a vnode', () => {
			render(<div>Hello World</div>, scratch);
			let root = scratch._previousVTree;

			let wrapped = patchRoot(root);

			expect(getPatchedRoot(root)).to.equal(wrapped);
			expect(getPatchedRoot(wrapped._children[0])).to.equal(wrapped);
		});

		it('should return null if unable to find the root', () => {
			render(<div>Hello World</div>, scratch);
			let root = scratch._previousVTree;
			root._el = document.body;

			expect(getPatchedRoot(root)).to.equal(null);
		});
	});

	describe('getData', () => {
		it('should convert vnode to DevtoolsData', () => {
			class App extends Component {
				render() {
					return <div>Hello World</div>;
				}
			}

			render(<App key="foo" active />, scratch);
			let vnode = scratch._previousVTree;
			vnode.startTime = 10;
			vnode.endTime = 12;

			let data = getData(vnode);

			expect(Object.keys(data.updater)).to.deep.equal(['setState', 'forceUpdate', 'setInState', 'setInProps', 'setInContext']);
			expect(data.publicInstance instanceof App).to.equal(true);
			expect(data.children.length).to.equal(1);
			expect(data.type).to.equal(App);

			// Delete non-serializable keys for easier assertion
			delete data.updater;
			delete data.publicInstance;
			delete data.children;
			delete data.type;

			expect(data).to.deep.equal({
				name: 'App',
				nodeType: 'Composite',
				props: { active: true },
				key: 'foo',
				state: {},
				ref: null,
				text: null,
				actualStartTime: 10,
				actualDuration: 2,
				treeBaseDuration: 2,
				memoizedInteractions: []
			});
		});

		it('should inline single text child', () => {
			render(<h1>Hello World</h1>, scratch);
			let data = getData(scratch._previousVTree);

			expect(data.children).to.equal('Hello World');
			expect(data.text).to.equal(null);
		});

		it('should convert text nodes', () => {
			render('Hello World', scratch);
			let data = getData(scratch._previousVTree);

			expect(data.children).to.equal(null);
			expect(data.text).to.equal('Hello World');
		});
	});

	it('should not initialize hook if __REACT_DEVTOOLS_GLOBAL_HOOK__ is not set', () => {
		options.enableProfiling = false;
		delete window.__REACT_DEVTOOLS_GLOBAL_HOOK__;

		initDevTools();
		expect(options.enableProfiling).to.equal(false);
	});

	it('should not throw if the root is null', () => {
		expect(() => render(null, scratch)).to.not.throw();
	});

	it('should not overwrite existing commitRoot hook', () => {
		let spy = sinon.spy();
		let spy2 = sinon.spy();
		options.commitRoot = spy;
		options.beforeUnmount = spy2;

		initDevTools();
		render(<div />, scratch);

		expect(spy).to.be.calledOnce;

		render(<span />, scratch);
		expect(spy2).to.be.calledOnce;
	});

	it('should connect only once', () => {
		let rid = Object.keys(hook._renderers)[0];
		let spy = sinon.spy(hook.helpers[rid], 'markConnected');
		hook.helpers[rid] = {};
		hook.helpers[rid] = {};

		expect(spy).to.be.not.called;
	});

	describe('renderer', () => {
		it('should not flush events if not connected', () => {
			let spy = sinon.spy(hook, 'emit');
			let renderer = new Renderer(hook, 'abc');
			renderer.flushPendingEvents();

			expect(spy).to.not.be.called;
		});

		it('should mount a root', () => {
			render(<div>Hello World</div>, scratch);
			checkEventReferences(hook.log);

			expect(hook.log.map(x => x.type)).to.deep.equal([
				'mount',
				'mount',
				'mount',
				'root',
				'rootCommitted'
			]);
		});

		it('should find dom node by vnode', () => {
			render(<div />, scratch);
			let vnode = scratch._previousVTree;
			let rid = Object.keys(hook._renderers)[0];
			let renderer = hook._renderers[rid];
			expect(renderer.findHostInstanceByFiber(vnode)).to.equal(vnode._el);
		});

		it('should find vnode by dom node', () => {
			render(<div />, scratch);
			let vnode = scratch._previousVTree;
			let rid = Object.keys(hook._renderers)[0];
			let renderer = hook._renderers[rid];
			expect(renderer.findFiberByHostInstance(scratch.firstChild)).to.equal(vnode);

			expect(renderer.findFiberByHostInstance(scratch)).to.equal(null);
		});

		it('should getNativeFromReactElement', () => {
			render(<div />, scratch);
			let vnode = scratch._previousVTree;
			let rid = Object.keys(hook._renderers)[0];
			let helpers = hook.helpers[rid];
			expect(helpers.getNativeFromReactElement(vnode)).to.equal(vnode._el);
		});

		it('should getReactElementFromNative', () => {
			render(<div />, scratch);
			let vnode = scratch._previousVTree;
			let rid = Object.keys(hook._renderers)[0];
			let helpers = hook.helpers[rid];
			expect(helpers.getReactElementFromNative(vnode._el)).to.equal(vnode);

			expect(helpers.getReactElementFromNative(document.body)).to.equal(null);
		});

		it('should detect when a root is updated', () => {
			render(<div>Hello World</div>, scratch);
			checkEventReferences(hook.log);

			let prev = hook.log.slice();
			hook.clear();

			render(<div>Foo</div>, scratch);
			checkEventReferences(prev.concat(hook.log));

			expect(hook.log.map(serialize)).to.deep.equal([
				{ type: 'updateProfileTimes', component: 'div' },
				{ type: 'update', component: 'Fragment' },
				{ type: 'rootCommitted', component: 'Fragment' }
			]);
		});

		it('should be able to swap children', () => {
			render(<div>Hello World</div>, scratch);
			checkEventReferences(hook.log);

			let prev = hook.log.slice();
			hook.clear();

			render(<div><span>Foo</span></div>, scratch);
			checkEventReferences(prev.concat(hook.log));

			expect(hook.log.map(serialize)).to.deep.equal([
				{ type: 'unmount', component: '#text' },
				{ type: 'mount', component: 'span' },
				{ type: 'updateProfileTimes', component: 'div' },
				{ type: 'update', component: 'Fragment' },
				{ type: 'rootCommitted', component: 'Fragment' }
			]);
		});

		it('should render multiple text children', () => {
			render(<div>foo{'bar'}</div>, scratch);
			checkEventReferences(hook.log);
		});

		it('should be able to swap children #2', () => {
			let updateState;
			class App extends Component {
				constructor() {
					super();
					this.state = { active: false };
					updateState = () => this.setState(prev => ({ active: !prev.active }));
				}

				render() {
					return (
						<div>
							{this.state.active && <h1>Hello World</h1>}
							<span>Foo</span>
						</div>
					);
				}
			}

			render(<App />, scratch);
			checkEventReferences(hook.log);

			let prev = hook.log.slice();
			hook.clear();

			updateState();
			rerender();
			checkEventReferences(prev.concat(hook.log));

			expect(hook.log.map(x => ({
				type: x.type,
				component: getDisplayName(x.internalInstance)
			}))).to.deep.equal([
				{ type: 'mount', component: 'h1' },
				{ type: 'updateProfileTimes', component: 'span' },
				{ type: 'updateProfileTimes', component: 'div' },
				{ type: 'update', component: 'App' },
				{ type: 'update', component: 'Fragment' },
				{ type: 'rootCommitted', component: 'Fragment' }
			]);
		});

		it('should only update profile times when nothing else changed', () => {
			render(<div><div><span>Hello World</span></div></div>, scratch);
			checkEventReferences(hook.log);

			let prev = hook.log.slice();
			hook.clear();

			render(<div><div><span>Foo</span></div></div>, scratch);
			checkEventReferences(prev.concat(hook.log));

			expect(hook.log.map(x => ({
				type: x.type,
				component: getDisplayName(x.internalInstance)
			}))).to.deep.equal([
				{ type: 'updateProfileTimes', component: 'span' },
				{ type: 'updateProfileTimes', component: 'div' },
				{ type: 'updateProfileTimes', component: 'div' },
				{ type: 'update', component: 'Fragment' },
				{ type: 'rootCommitted', component: 'Fragment' }
			]);
		});

		it('should detect when a component is unmounted', () => {
			render(<div><span>Hello World</span></div>, scratch);
			checkEventReferences(hook.log);
			hook.clear();

			render(<div />, scratch);
			expect(hook.log.map(serialize)).to.deep.equal([
				{ type: 'unmount', component: 'span' },
				{ type: 'unmount', component: '#text' },
				{ type: 'update', component: 'div' },
				{ type: 'update', component: 'Fragment' },
				{ type: 'rootCommitted', component: 'Fragment' }
			]);
		});

		it('should be able to render Fragments', () => {
			render(<div><Fragment>foo{'bar'}</Fragment></div>, scratch);
			checkEventReferences(hook.log);
		});

		it('should detect setState update', () => {
			let updateState;

			class Foo extends Component {
				constructor() {
					super();
					updateState = () => this.setState(prev => ({ active: !prev.active }));
				}

				render() {
					return <h1>{this.state.active ? 'foo' : 'bar'}</h1>;
				}
			}

			render(<Foo />, scratch);
			let prev = hook.log.slice();
			hook.clear();

			updateState();
			rerender();

			checkEventReferences(prev.concat(hook.log));

			// Previous `internalInstance` from mount must be referentially equal to
			// `internalInstance` from update
			hook.log.filter(x => x.type === 'update').forEach(next => {
				let update = prev.find(old =>
					old.type === 'mount' && old.internalInstance === next.internalInstance);

				expect(update).to.not.equal(undefined);

				// ...and the same rules apply for `data.children`. Note that
				// `data.children`is not always an array.
				let children = update.data.children;
				if (Array.isArray(children)) {
					children.forEach(child => {
						let prevChild = prev.find(x => x.internalInstance === child);
						expect(prevChild).to.not.equal(undefined);
					});
				}
			});
		});

		describe('updater', () => {
			it('should update state', () => {
				class App extends Component {
					constructor() {
						super();
						this.state = { active: true };
					}

					render() {
						return <h1>{this.state.active ? 'foo' : 'bar'}</h1>;
					}
				}
				render(<App />, scratch);
				expect(scratch.textContent).to.equal('foo');

				let event = hook.log.find(x => x.data.publicInstance instanceof App);
				event.data.updater.setInState(['active'], false);
				rerender();

				checkEventReferences(hook.log);

				expect(scratch.textContent).to.equal('bar');
			});

			it('should update props', () => {
				function App(props) {
					return <h1>{props.active ? 'foo' : 'bar'}</h1>;
				}
				render(<App active />, scratch);
				expect(scratch.textContent).to.equal('foo');

				let event = hook.log.find(x => x.data.publicInstance instanceof Component);
				event.data.updater.setInProps(['active'], false);
				rerender();

				expect(scratch.textContent).to.equal('bar');
			});

			it('should update context', () => {
				class Wrapper extends Component {
					getChildContext() {
						return { active: true };
					}

					render() {
						return <div>{this.props.children}</div>;
					}
				}

				class App extends Component {
					constructor() {
						super();
						this.context = { active: true };
					}

					render() {
						return <h1>{this.context.active ? 'foo' : 'bar'}</h1>;
					}
				}
				render(<Wrapper><App /></Wrapper>, scratch);
				expect(scratch.textContent).to.equal('foo');

				let event = hook.log.find(x => x.data.publicInstance instanceof App);
				event.data.updater.setInContext(['active'], false);
				rerender();

				checkEventReferences(hook.log);

				expect(scratch.textContent).to.equal('bar');
			});
		});

		describe('Profiler', () => {
			it('should collect timings', () => {
				render(<div>Hello World</div>, scratch);

				hook.log.forEach(ev => {
					expect(ev.data.actualStartTime > 0).to.equal(true);
				});
			});

			it('should calculate treeBaseDuration', () => {
				render(<div>Hello World</div>, scratch);

				hook.log.forEach(ev => {
					expect(ev.data.treeBaseDuration > -1).to.equal(true);
				});
			});
		});
	});
});
