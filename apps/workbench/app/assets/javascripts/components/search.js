// Copyright (C) The Arvados Authors. All rights reserved.
//
// SPDX-License-Identifier: AGPL-3.0

window.SearchResultsTable = {
    maybeLoadMore: function(dom) {
        var loader = this.loader
        if (loader.state != loader.READY)
            // Can't start getting more items anyway: no point in
            // checking anything else.
            return
        var contentRect = dom.getBoundingClientRect()
        var scroller = window // TODO: use dom's nearest ancestor with scrollbars
        if (contentRect.bottom < 2 * scroller.innerHeight) {
            // We have less than 1 page worth of content available
            // below the visible area. Load more.
            loader.loadMore()
            // Indicate loading is in progress.
            window.requestAnimationFrame(m.redraw)
        }
    },
    oncreate: function(vnode) {
        vnode.state.maybeLoadMore = vnode.state.maybeLoadMore.bind(vnode.state, vnode.dom)
        window.addEventListener('scroll', vnode.state.maybeLoadMore)
        window.addEventListener('resize', vnode.state.maybeLoadMore)
        vnode.state.timer = window.setInterval(vnode.state.maybeLoadMore, 200)
        vnode.state.loader = vnode.attrs.loader
        vnode.state.onupdate(vnode)
    },
    onupdate: function(vnode) {
        vnode.state.loader = vnode.attrs.loader
        // This activates bootstrap tooltip feature
        $(function () {
            $('[data-toggle="tooltip"]').tooltip()
        })
    },
    onremove: function(vnode) {
        window.clearInterval(vnode.state.timer)
        window.removeEventListener('scroll', vnode.state.maybeLoadMore)
        window.removeEventListener('resize', vnode.state.maybeLoadMore)
    },
    view: function(vnode) {
        var loader = vnode.attrs.loader
        var iconsMap = {
            C: m('i.fa.fa-fw.fa-archive'),
            P: m('i.fa.fa-fw.fa-folder'),
        }
        return m('table.table.table-condensed', [
            m('thead', m('tr', [
                m('th'),
                m('th', 'uuid'),
                m('th', 'name'),
                m('th', 'last modified'),
            ])),
            m('tbody', [
                loader.items().map(function(item) {
                    return m('tr', [
                        m('td', [
                            item.workbenchBaseURL() &&
                                m('a.btn.btn-xs.btn-default', {
                                    'data-original-title': 'show '+item.objectType.description,
                                    'data-placement': 'top',
                                    'data-toggle': 'tooltip',
                                    href: item.workbenchBaseURL()+'/'+item.objectType.wb_path+'/'+item.uuid,
                                }, iconsMap[item.objectType.label]),
                        ]),
                        m('td.arvados-uuid', item.uuid),
                        m('td', item.name || '(unnamed)'),
                        m('td', m(LocalizedDateTime, {parse: item.modified_at})),
                    ])
                }),
            ]),
            loader.state == loader.DONE ? null : m('tfoot', m('tr', [
                m('th[colspan=4]', m('button.btn.btn-xs', {
                    className: loader.state == loader.LOADING ? 'btn-default' : 'btn-primary',
                    style: {
                        display: 'block',
                        width: '12em',
                        marginLeft: 'auto',
                        marginRight: 'auto',
                    },
                    disabled: loader.state == loader.LOADING,
                    onclick: function() {
                        loader.loadMore()
                        return false
                    },
                }, loader.state == loader.LOADING ? '(loading)' : 'Load more')),
            ])),
        ])
    },
}

window.Search = {
    oninit: function(vnode) {
        vnode.state.sessionDB = new SessionDB()
        vnode.state.searchEntered = m.stream()
        vnode.state.searchActive = m.stream()
        // When searchActive changes (e.g., when restoring state
        // after navigation), update the text field too.
        vnode.state.searchActive.map(vnode.state.searchEntered)
        // When searchActive changes, create a new loader that filters
        // with the given search term.
        vnode.state.searchActive.map(function(q) {
            var sessions = vnode.state.sessionDB.loadActive()
            vnode.state.loader = new MergingLoader({
                children: Object.keys(sessions).map(function(key) {
                    var session = sessions[key]
                    var workbenchBaseURL = function() {
                        return vnode.state.sessionDB.workbenchBaseURL(session)
                    }
                    var searchable_objects = [
                        {
                            wb_path: 'groups',
                            api_path: 'arvados/v1/groups',
                            filters: [['group_class', '=', 'project']],
                            label: 'P',
                            description: 'project',
                        },
                        {
                            wb_path: 'collections',
                            api_path: 'arvados/v1/collections',
                            filters: [],
                            label: 'C',
                            description: 'collection',
                        },
                    ]
                    return new MergingLoader({
                        sessionKey: key,
                        // For every session, search for every object type
                        children: searchable_objects.map(function(obj_type) {
                            return new MultipageLoader({
                                sessionKey: key,
                                objectKind: obj_type.label,
                                loadFunc: function(filters) {
                                    var tsquery = to_tsquery(q)
                                    if (tsquery) {
                                        filters = filters.slice(0)
                                        filters.push(['any', '@@', tsquery])
                                    }
                                    // Apply additional type dependant filters, if any.
                                    for (i = 0; i < obj_type.filters.length; i++) {
                                        filters.push(obj_type.filters[i])
                                    }
                                    return vnode.state.sessionDB.request(session, obj_type.api_path, {
                                        data: {
                                            filters: JSON.stringify(filters),
                                            count: 'none',
                                        },
                                    }).then(function(resp) {
                                        resp.items.map(function(item) {
                                            item.workbenchBaseURL = workbenchBaseURL
                                            item.objectType = obj_type
                                        })
                                        return resp
                                    })
                                },
                            })
                        }),
                    })
                }),
            })
        })
    },
    view: function(vnode) {
        var sessions = vnode.state.sessionDB.loadAll()
        return m('form', {
            onsubmit: function() {
                vnode.state.searchActive(vnode.state.searchEntered())
                vnode.state.forgetSavedHeight = true
                return false
            },
        }, [
            m(SaveUIState, {
                defaultState: '',
                currentState: vnode.state.searchActive,
                forgetSavedHeight: vnode.state.forgetSavedHeight,
                saveBodyHeight: true,
            }),
            vnode.state.loader && [
                m('.row', [
                    m('.col-md-6', [
                        m('.input-group', [
                            m('input#search.form-control[placeholder=Search collections and projects]', {
                                oninput: m.withAttr('value', vnode.state.searchEntered),
                                value: vnode.state.searchEntered(),
                            }),
                            m('.input-group-btn', [
                                m('input.btn.btn-primary[type=submit][value="Search"]'),
                            ]),
                        ]),
                    ]),
                    m('.col-md-6', [
                        'Searching sites: ',
                        vnode.state.loader.children.length == 0
                            ? m('span.label.label-xs.label-danger', 'none')
                            : vnode.state.loader.children.map(function(child) {
                                return [m('span.label.label-xs', {
                                    className: child.state == child.LOADING ? 'label-warning' : 'label-success',
                                }, child.sessionKey), ' ']
                            }),
                        ' ',
                        m('a[href="/sessions"]', 'Add/remove sites'),
                    ]),
                ]),
                m(SearchResultsTable, {
                    loader: vnode.state.loader,
                }),
            ],
        ])
    },
}
