// Copyright (C) The Arvados Authors. All rights reserved.
//
// SPDX-License-Identifier: AGPL-3.0

package main

import (
	"crypto/rand"
	"errors"
	"fmt"
	prand "math/rand"
	"net/http"
	"os"
	"sync/atomic"
	"time"

	"golang.org/x/net/context"
	"golang.org/x/net/webdav"
)

var (
	lockPrefix     string = uuid()
	nextLockSuffix int64  = prand.Int63()
	errReadOnly           = errors.New("read-only filesystem")
)

// webdavFS implements a read-only webdav.FileSystem by wrapping
// http.Filesystem.
type webdavFS struct {
	httpfs http.FileSystem
}

var _ webdav.FileSystem = &webdavFS{}

func (fs *webdavFS) Mkdir(ctx context.Context, name string, perm os.FileMode) error {
	return errReadOnly
}

func (fs *webdavFS) OpenFile(ctx context.Context, name string, flag int, perm os.FileMode) (webdav.File, error) {
	f, err := fs.httpfs.Open(name)
	if err != nil {
		return nil, err
	}
	return &webdavFile{File: f}, nil
}

func (fs *webdavFS) RemoveAll(ctx context.Context, name string) error {
	return errReadOnly
}

func (fs *webdavFS) Rename(ctx context.Context, oldName, newName string) error {
	return errReadOnly
}

func (fs *webdavFS) Stat(ctx context.Context, name string) (os.FileInfo, error) {
	if f, err := fs.httpfs.Open(name); err != nil {
		return nil, err
	} else {
		return f.Stat()
	}
}

// webdavFile implements a read-only webdav.File by wrapping
// http.File. Writes fail.
type webdavFile struct {
	http.File
}

func (f *webdavFile) Write([]byte) (int, error) {
	return 0, errReadOnly
}

// noLockSystem implements webdav.LockSystem by returning success for
// every possible locking operation, even though it has no side
// effects such as actually locking anything. This works for a
// read-only webdav filesystem because webdav locks only apply to
// writes.
//
// This is more suitable than webdav.NewMemLS() for two reasons:
// First, it allows keep-web to use one locker for all collections
// even though coll1.vhost/foo and coll2.vhost/foo have the same path
// but represent different resources. Additionally, it returns valid
// tokens (rfc2518 specifies that tokens are represented as URIs and
// are unique across all resources for all time), which might improve
// client compatibility.
//
// However, it does also permit impossible operations, like acquiring
// conflicting locks and releasing non-existent locks.  This might
// confuse some clients if they try to probe for correctness.
//
// Currently this is a moot point: the LOCK and UNLOCK methods are not
// accepted by keep-web, so it suffices to implement the
// webdav.LockSystem interface.
type noLockSystem struct{}

func (*noLockSystem) Confirm(time.Time, string, string, ...webdav.Condition) (func(), error) {
	return noop, nil
}

func (*noLockSystem) Create(now time.Time, details webdav.LockDetails) (token string, err error) {
	return fmt.Sprintf("opaquelocktoken:%s-%x", lockPrefix, atomic.AddInt64(&nextLockSuffix, 1)), nil
}

func (*noLockSystem) Refresh(now time.Time, token string, duration time.Duration) (webdav.LockDetails, error) {
	return webdav.LockDetails{}, nil
}

func (*noLockSystem) Unlock(now time.Time, token string) error {
	return nil
}

func noop() {}

// Return a version 1 variant 4 UUID, meaning all bits are random
// except the ones indicating the version and variant.
func uuid() string {
	var data [16]byte
	if _, err := rand.Read(data[:]); err != nil {
		panic(err)
	}
	// variant 1: N=10xx
	data[8] = data[8]&0x3f | 0x80
	// version 4: M=0100
	data[6] = data[6]&0x0f | 0x40
	return fmt.Sprintf("%x-%x-%x-%x-%x", data[0:4], data[4:6], data[6:8], data[8:10], data[10:])
}
