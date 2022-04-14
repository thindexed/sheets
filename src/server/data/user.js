const fs = require('fs-extra')
const path = require('path')
const glob = require("glob")
const {createHash } =  require('crypto')
  
const filesystem = require("../utils/file")
const github = require('../utils/github')
const conf = require("../configuration")

function nocache(req, res, next) {
    res.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
    res.header('Expires', '-1');
    res.header('Pragma', 'no-cache');
    next();
}

function ensureLoggedIn  (req, res, next) {
    let role = req.get("x-role")
    if (role !== "admin" && role !== "user") {
        res.status(401).send('string')
        return
    }
    let hash = createHash('sha256')
    hash.update(req.get("x-mail"))
    req.headers["x-hash"]=hash.digest('hex')
    next()
}

module.exports = {
    init: function (app) {
        // TODO: migrate to REST service API
        app.get('/sheets/user/list', nocache, ensureLoggedIn, (req, res) => {
            filesystem.listFiles(conf.absoluteUserDataDirectory(req), req.query.path, res)
                .catch(exception => {
                    console.log(exception)
                })
        })

        app.get('/sheets/user/get', nocache, ensureLoggedIn, (req, res) => {
            filesystem.getJSONFile(conf.absoluteUserDataDirectory(req), req.query.filePath, res)
                .catch(exception => {
                    console.log(exception)
                })
        })

        app.get('/sheets/user/image', nocache, ensureLoggedIn, (req, res) => {
            filesystem.getBinaryFile(conf.absoluteUserDataDirectory(req), req.query.filePath, res)
                .catch(error => {
                    console.log(error)
                })
        })


        app.post('/sheets/user/delete', ensureLoggedIn, (req, res) => {
            let fileRelativePath = req.body.filePath
            let isDir = fs.lstatSync(path.join(conf.absoluteUserDataDirectory(req), fileRelativePath)).isDirectory()
            if (isDir) {
                filesystem.delete(conf.absoluteUserDataDirectory(req), fileRelativePath)
                    .then((sanitizedRelativePath) => {
                        let githubPath = path.join(conf.githubUserDataDirectory(req), sanitizedRelativePath)
                        return github.deleteDirectory(githubPath, "-delete directory-")
                    })
                    .then(() => {
                        res.send("ok")
                    })
                    .catch((error) => {
                        console.log(error)
                        res.status(403).send("error")
                    })
            }
            else {

                filesystem.delete(conf.absoluteUserDataDirectory(req), fileRelativePath)
                    .then((sanitizedRelativePaths) => {
                        files = [sanitizedRelativePaths]
                        github.delete(files.map(file => { return { path: path.join(conf.githubUserDataDirectory(req), file) } }), "-empty-")
                        .catch( ()=>{ /* ignore */})
                        res.send("ok")
                    })
                    .catch(() => {
                        res.status(403).send("error")
                    })
            }
        })

        app.post('/sheets/user/rename', ensureLoggedIn, (req, res) => {
            filesystem.rename(conf.absoluteUserDataDirectory(req), req.body.from, req.body.to, res)
                .then(({ fromRelativePath, toRelativePath, isDir }) => {
                    repoFromRelativePath = path.join(conf.githubUserDataDirectory(req), fromRelativePath)
                    repoToRelativePath = path.join(conf.githubUserDataDirectory(req), toRelativePath)

                    if (isDir) {
                        // rename all files in github
                        github.renameDirectory(repoFromRelativePath, repoToRelativePath, "-rename-")
                        .catch(error => { 
                            console.log(error) 
                        })
                    }
                    else {
                        let fromFiles = [repoFromRelativePath]
                        let toFiles = [repoToRelativePath]
                        // rename ALL files in one commit in github
                        github.renameFiles(fromFiles, toFiles, ` ${fromRelativePath} => ${toRelativePath}`)
                        .catch( error => { 
                            console.log(error) 
                        })
                    }
                })
                .catch(reason => {
                    console.log(reason)
                })
        })

        app.post('/sheets/user/folder', ensureLoggedIn, (req, res) => {
            filesystem.createFolder(conf.absoluteUserDataDirectory(req), req.body.filePath, res)
                .then((directoryRelativePath) => {
                    let fileRelativePath =  path.join(directoryRelativePath, "placeholder.txt")
                    let content =  "-placeholder for empty directories-"
                    // create file into empty directory. Otherwise the directory is not stored in github.
                    // (github prunes empty directories)
                    filesystem.writeFile(conf.absoluteUserDataDirectory(req), fileRelativePath, content)
                    return github.commit([{ path: path.join(conf.githubUserDataDirectory(req), fileRelativePath), content: content }], "folder creation")
                })
                .catch(error => {
                    console.log(error)
                })
        })

        app.post('/sheets/user/save', ensureLoggedIn, (req, res) => {
            let shapeRelativePath = req.body.filePath
            let content = req.body.content
            let reason = req.body.commitMessage || "-empty-"
            filesystem.writeFile(conf.absoluteUserDataDirectory(req), shapeRelativePath, content, res)
                .then((sanitizedRelativePath) => {
                    return github.commit([{ path: path.join(conf.githubUserDataDirectory(req), sanitizedRelativePath), content: content } ], reason)
                })
                .catch(reason => {
                    console.log(reason)
                })
        })
    }
}
